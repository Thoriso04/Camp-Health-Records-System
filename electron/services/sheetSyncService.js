// electron/services/sheetSyncService.js
//
// Pulls camper registrations from the Google Form's response sheet into the
// local encrypted database. This is the ONLY part of CHRS that touches the
// network, and it only runs when someone presses "Sync now". Every other
// feature reads and writes the local database alone, so the app stays fully
// usable offline.
//
// Duplicate protection (three independent layers):
//   1. Ledger — every processed sheet row is recorded in sheet_sync_rows,
//      keyed on the Forms response timestamp. Pressing Sync twice, or syncing
//      from two laptops that share a database copy, can never re-import a row.
//   2. Natural key — a child already in the database (entered by hand, via
//      CSV, or submitted twice on the Form) is matched on first name + surname
//      + date of birth + camp session date, exactly as the CSV importer does,
//      and is not inserted again.
//   3. One transaction — all inserts, ledger rows and audit entries for a sync
//      commit together or not at all.
//
// Rows are never updated or deleted by a sync. If a row that was already
// imported is later edited in the sheet, the sync reports it as "changed in
// sheet" instead of silently overwriting what clinicians may have since
// recorded locally.
//
// The same pipeline also serves the registration CSV import
// (registrationCsvImport.js): a CSV downloaded from the response sheet is
// turned into the same 2-D array and goes through applySheetValues, so it
// gets the identical ledger, natural-key and transaction protection. Only
// `sourceType` differs, and that only changes labels and the log.
//
// Photos: a row's photo cell is resolved by registrationPhotos.js. No photo,
// or a photo that can't be resolved, is stored as blank (never a placeholder).
// A Form upload question leaves a Google Drive link in the cell. This module
// stays network-free for that: the Electron main process downloads the photos
// (googleDriveClient.js), the renderer shrinks them, and they come back in as
// `photoFiles` entries keyed "drive:<fileId>".

const { createPatientProfile } = require('./patientProfileService');
const { resolveActiveUserId } = require('./userService');
const { mapSheetValues } = require('./sheetRowMapper');
const { buildPhotoIndex, resolvePhoto } = require('./registrationPhotos');
const {
  SheetSyncError,
  loadSyncConfig,
  readServiceAccountKey,
  createSheetsClient,
} = require('./googleSheetsClient');

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const SOURCE_TYPES = new Set(['google_sheet', 'csv_file']);

function logFailedSync(db, userId, error, sourceType = 'google_sheet') {
  try {
    db.prepare(`
      INSERT INTO sheet_sync_log (triggered_by, status, error_message, source)
      VALUES (?, 'failed', ?, ?)
    `).run(userId, String(error?.message ?? error).slice(0, 500), sourceType);
  } catch (_) {
    // Never let logging mask the real failure.
  }
}

function describeSource({ sourceType, sheetName, sourceName }) {
  if (sourceType === 'csv_file') {
    // The file name is only ever shown to people; strip anything odd.
    const clean = String(sourceName ?? '').replace(/[^\x20-\x7e\u00a0-\uffff]/g, '').trim().slice(0, 120);
    return `CSV file "${clean || 'unnamed'}"`;
  }
  return `Google Sheet "${sheetName}"`;
}

function naturalKey({ firstName, surname, dateOfBirth }, sessionDate) {
  return [firstName, surname].map((part) => part.trim().toLowerCase()).concat(dateOfBirth, sessionDate).join('|');
}

/**
 * Decides, without writing anything, what a sync would do with each row.
 * Used by both the real import and the preview, so the preview can never
 * promise something the import then does differently.
 *
 * Outcomes per row: invalid | already_synced | matched_existing | import.
 * A row that repeats a child appearing earlier in the same batch (the form
 * submitted twice) is matched to that earlier row rather than imported twice.
 */
function classifyRows(db, mapped, { campSessionDate, photoFiles }) {
  const findLedgerRow = db.prepare('SELECT content_hash FROM sheet_sync_rows WHERE source_key = ?');
  const findExistingPatient = db.prepare(`
    SELECT id FROM patients
    WHERE deleted_at IS NULL
      AND lower(trim(first_name)) = lower(@firstName)
      AND lower(trim(last_name)) = lower(@surname)
      AND date_of_birth = @dateOfBirth
      AND camp_session_date = @campSessionDate
    LIMIT 1
  `);
  const photoIndex = buildPhotoIndex(photoFiles);
  const plannedImports = new Map(); // natural key -> row number that will create the child

  const decisions = mapped.rows.map((row) => {
    if (row.errors.length > 0) return { row, outcome: 'invalid' };

    const ledgerRow = findLedgerRow.get(row.sourceKey);
    if (ledgerRow) {
      return { row, outcome: 'already_synced', changedInSource: ledgerRow.content_hash !== row.contentHash };
    }

    const sessionDate = row.campSessionDate ?? campSessionDate;
    const key = naturalKey(row.profile, sessionDate);
    const existing = findExistingPatient.get({
      firstName: row.profile.firstName,
      surname: row.profile.surname,
      dateOfBirth: row.profile.dateOfBirth,
      campSessionDate: sessionDate,
    });
    if (existing) return { row, outcome: 'matched_existing', sessionDate, existingId: existing.id };
    if (plannedImports.has(key)) return { row, outcome: 'matched_existing', sessionDate, naturalKey: key };

    plannedImports.set(key, row.rowNumber);
    return { row, outcome: 'import', sessionDate, naturalKey: key, photo: resolvePhoto(row.photoReference, photoIndex) };
  });

  return decisions;
}

function summarise(decisions) {
  const summary = {
    rowsRead: decisions.length,
    imported: 0,
    alreadySynced: 0,
    matchedExisting: 0,
    changedInSheet: [],
    invalid: [],
    photosAdded: 0,
    photoWarnings: [],
  };
  for (const { row, outcome, changedInSource, photo } of decisions) {
    if (outcome === 'invalid') summary.invalid.push({ rowNumber: row.rowNumber, reasons: row.errors });
    else if (outcome === 'already_synced') {
      summary.alreadySynced += 1;
      if (changedInSource) summary.changedInSheet.push(row.rowNumber);
    } else if (outcome === 'matched_existing') summary.matchedExisting += 1;
    else {
      summary.imported += 1;
      if (photo.dataUrl) summary.photosAdded += 1;
      else if (photo.status !== 'none') summary.photoWarnings.push({ rowNumber: row.rowNumber, message: photo.message });
    }
  }
  return summary;
}

function assertSessionDate(campSessionDate) {
  if (!isValidDate(campSessionDate)) {
    throw new SheetSyncError('Choose a valid camp session date before syncing.', 'INVALID_INPUT');
  }
}

function mapOrThrow(values, { spreadsheetId, sheetName, today }) {
  const mapped = mapSheetValues(values, { spreadsheetId, sheetName, today });
  if (mapped.headerError) throw new SheetSyncError(mapped.headerError, 'BAD_HEADERS');
  return mapped;
}

/**
 * Read-only: reports what applySheetValues would do, row by row, and writes
 * nothing (no patients, no ledger rows, no log entry, no audit entry).
 * Takes the same options as applySheetValues.
 */
function previewSheetValues(db, { values, spreadsheetId, sheetName, campSessionDate, photoFiles, today }) {
  assertSessionDate(campSessionDate);
  const mapped = mapOrThrow(values, { spreadsheetId, sheetName, today });
  const decisions = classifyRows(db, mapped, { campSessionDate, photoFiles });

  // Photos the Form's upload question left on Google Drive for children who
  // are about to be added. The app downloads exactly these, nothing else.
  const drivePhotoIds = [...new Set(
    decisions
      .filter(({ outcome, photo }) => outcome === 'import' && photo?.status === 'drive_pending')
      .map(({ photo }) => photo.driveFileId)
  )];

  return {
    success: true,
    ...summarise(decisions),
    ignoredColumns: mapped.ignoredColumns,
    photoColumnFound: mapped.photoColumnFound,
    drivePhotoIds,
    rows: decisions.map(({ row, outcome, changedInSource, photo }) => ({
      rowNumber: row.rowNumber,
      name: [row.profile.firstName, row.profile.surname].filter(Boolean).join(' '),
      dateOfBirth: row.profile.dateOfBirth,
      outcome,
      reasons: outcome === 'invalid' ? row.errors : [],
      changedInSource: Boolean(changedInSource),
      photo: photo ? { status: photo.status, message: photo.message } : null,
    })),
  };
}

/**
 * Reads the Google Sheet and reports what a sync would do, writing nothing.
 * Used to learn which Drive photos need downloading before the real sync.
 * `readValues` is injectable for tests, like runGoogleSheetSync.
 */
async function previewGoogleSheet(db, { userDataDir, env = process.env, campSessionDate, photoFiles, readValues, today } = {}) {
  const config = loadSyncConfig({ env, userDataDir });
  if (!config) {
    throw new SheetSyncError(
      'Google Sheet sync has not been set up on this laptop yet. See docs/GOOGLE_SHEET_SYNC.md (section "Set up a laptop").',
      'NOT_CONFIGURED'
    );
  }
  assertSessionDate(campSessionDate);
  const fetchValues = readValues ?? (() => {
    const client = createSheetsClient({ serviceAccount: readServiceAccountKey(config.keyFilePath) });
    return client.readSheetValues({ spreadsheetId: config.spreadsheetId, sheetName: config.sheetName });
  });
  const values = await fetchValues(config);
  return previewSheetValues(db, {
    values, spreadsheetId: config.spreadsheetId, sheetName: config.sheetName, campSessionDate, photoFiles, today,
  });
}

/**
 * Applies already-fetched sheet contents to the database. Synchronous and
 * network-free so it can be tested exhaustively against an in-memory DB.
 *
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @param {object} options
 * @param {any[][]} options.values            header row + data rows from the sheet
 * @param {string}  options.spreadsheetId     identity of the source; part of each row's ledger key
 * @param {string}  options.sheetName         ditto
 * @param {string}  options.campSessionDate   YYYY-MM-DD; used for rows without their own session-date column
 * @param {string|number} options.syncedByUserId
 * @param {Record<string,string>} [options.photoFiles]  file name -> image data URL, for the photo column
 * @param {'google_sheet'|'csv_file'} [options.sourceType]
 * @param {string} [options.sourceName]       file name, shown in the audit trail for CSV imports
 */
function applySheetValues(db, {
  values, spreadsheetId, sheetName, campSessionDate, syncedByUserId, today,
  photoFiles, sourceType = 'google_sheet', sourceName,
}) {
  assertSessionDate(campSessionDate);
  if (!SOURCE_TYPES.has(sourceType)) throw new SheetSyncError(`Unknown import source "${sourceType}".`, 'INVALID_INPUT');
  const syncedBy = resolveActiveUserId(db, syncedByUserId);

  const mapped = mapOrThrow(values, { spreadsheetId, sheetName, today });
  const sourceLabel = describeSource({ sourceType, sheetName, sourceName });

  const insertLedgerRow = db.prepare(`
    INSERT INTO sheet_sync_rows (source_key, patient_id, sheet_row_number, content_hash, outcome)
    VALUES (@sourceKey, @patientId, @rowNumber, @contentHash, @outcome)
  `);

  return db.transaction(() => {
    const decisions = classifyRows(db, mapped, { campSessionDate, photoFiles });
    const createdIds = new Map(); // natural key -> id of the child created earlier in this batch

    for (const decision of decisions) {
      const { row, outcome } = decision;

      if (outcome === 'import') {
        const created = createPatientProfile(db, {
          ...row.profile,
          // Blank (null) unless a real photo was resolved. Never a placeholder.
          photoDataUrl: decision.photo.dataUrl,
          campSessionDate: decision.sessionDate,
          createdByUserId: syncedBy,
          source: sourceType,
          auditDetails: `Imported from ${sourceLabel}, row ${row.rowNumber}`,
        });
        createdIds.set(decision.naturalKey, Number(created.id));
        insertLedgerRow.run({
          sourceKey: row.sourceKey,
          patientId: Number(created.id),
          rowNumber: row.rowNumber,
          contentHash: row.contentHash,
          outcome: 'imported',
        });
      } else if (outcome === 'matched_existing') {
        insertLedgerRow.run({
          sourceKey: row.sourceKey,
          patientId: decision.existingId ?? createdIds.get(decision.naturalKey),
          rowNumber: row.rowNumber,
          contentHash: row.contentHash,
          outcome: 'matched_existing',
        });
      }
    }

    const summary = summarise(decisions);
    db.prepare(`
      INSERT INTO sheet_sync_log
        (triggered_by, status, rows_read, imported, already_synced, matched_existing, invalid_rows, changed_in_sheet, source)
      VALUES (?, 'success', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      syncedBy,
      summary.rowsRead,
      summary.imported,
      summary.alreadySynced,
      summary.matchedExisting,
      summary.invalid.length,
      summary.changedInSheet.length,
      sourceType
    );

    return {
      success: true,
      ...summary,
      ignoredColumns: mapped.ignoredColumns,
      syncedAt: new Date().toISOString(),
    };
  })();
}

/**
 * Full sync: load config, read the sheet from Google, apply it locally.
 * If anything fails before the local transaction (offline, bad key, no
 * access, wrong columns) the database is left completely untouched and the
 * failure is recorded in sheet_sync_log.
 *
 * `readValues` is injectable so the whole flow can be tested without Google.
 */
async function runGoogleSheetSync(db, { userDataDir, env = process.env, syncedByUserId, campSessionDate, readValues, today, photoFiles } = {}) {
  try {
    const config = loadSyncConfig({ env, userDataDir });
    if (!config) {
      throw new SheetSyncError(
        'Google Sheet sync has not been set up on this laptop yet. See docs/GOOGLE_SHEET_SYNC.md (section "Set up a laptop").',
        'NOT_CONFIGURED'
      );
    }
    if (!isValidDate(campSessionDate)) {
      throw new SheetSyncError('Choose a valid camp session date before syncing.', 'INVALID_INPUT');
    }
    resolveActiveUserId(db, syncedByUserId); // fail early, before any network call

    const fetchValues = readValues ?? (() => {
      const client = createSheetsClient({ serviceAccount: readServiceAccountKey(config.keyFilePath) });
      return client.readSheetValues({ spreadsheetId: config.spreadsheetId, sheetName: config.sheetName });
    });
    const values = await fetchValues(config);

    return applySheetValues(db, {
      values,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      campSessionDate,
      syncedByUserId,
      today,
      photoFiles,
    });
  } catch (error) {
    let userId = null;
    try { userId = resolveActiveUserId(db, syncedByUserId); } catch (_) { /* not signed in as a DB user */ }
    logFailedSync(db, userId, error);
    throw error;
  }
}

/**
 * Cheap, offline, never throws: what the dashboard needs to render the
 * "Sync" card (is it set up? when did it last succeed?).
 */
function getSheetSyncStatus(db, { userDataDir, env = process.env } = {}) {
  let configured = false;
  let sheetName = null;
  let configProblem = null;
  try {
    const config = loadSyncConfig({ env, userDataDir });
    configured = Boolean(config);
    sheetName = config?.sheetName ?? null;
  } catch (error) {
    configProblem = error.message;
  }

  let lastSync = null;
  let lastAttempt = null;
  try {
    lastSync = db.prepare(`
      SELECT event_time AS eventTime, rows_read AS rowsRead, imported
      FROM sheet_sync_log WHERE status = 'success' AND source = 'google_sheet' ORDER BY id DESC LIMIT 1
    `).get() ?? null;
    lastAttempt = db.prepare(`
      SELECT event_time AS eventTime, status, error_message AS errorMessage
      FROM sheet_sync_log WHERE source = 'google_sheet' ORDER BY id DESC LIMIT 1
    `).get() ?? null;
  } catch (_) {
    // Table missing would mean migrations haven't run; show "never synced".
  }

  return { success: true, configured, sheetName, configProblem, lastSync, lastAttempt };
}

module.exports = {
  applySheetValues,
  previewSheetValues,
  previewGoogleSheet,
  logFailedSync,
  runGoogleSheetSync,
  getSheetSyncStatus,
};
