const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { applyMigrations } = require('../electron/database/database');
const { applySheetValues, runGoogleSheetSync, getSheetSyncStatus } = require('../electron/services/sheetSyncService');
const { createPatientProfile } = require('../electron/services/patientProfileService');
const { createAuditLogger } = require('../electron/database/auditLog');

const HEADERS = [
  'Timestamp', "Child's Name", 'Surname', 'Date of birth', 'Sex', 'Diagnosis', 'Allergies',
  'Current medication', 'Parent/Primary Caregiver Name & Surname', 'Parent/Caregiver cell number',
  'Emergency contact name', 'Emergency contact cell number', 'Emergency contact relationship',
  'Consent to disclosure',
];

// Google Sheets stores dates as days since 1899-12-30.
const serial = (y, m, d, fraction = 0) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000 + fraction;

function response({ ts = serial(2026, 6, 1, 0.5), first = 'Thandi', last = 'Nkosi', dob = serial(2012, 5, 14), allergies = 'Peanuts, Penicillin', consent = 'I consent' } = {}) {
  return [ts, first, last, dob, 'Female', 'HIV', allergies, 'Efavirenz 600mg\nCotrimoxazole', 'Mrs Nkosi', 821234567, 'Aunt Zodwa', '0839876543', 'Aunt', consent];
}

const CONTEXT = { spreadsheetId: 'sheet-1', sheetName: 'Form Responses 1', campSessionDate: '2026-06-29', today: '2026-10-02' };

describe('Google Sheet registration sync', () => {
  let db;
  let adminId;
  const sync = (rows, overrides = {}) => applySheetValues(db, { ...CONTEXT, values: [HEADERS, ...rows], syncedByUserId: adminId, ...overrides });
  const patientCount = () => db.prepare('SELECT COUNT(*) AS n FROM patients').get().n;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../electron/database/schema.sql'), 'utf8'));
    applyMigrations(db);
    adminId = db.prepare(`INSERT INTO users (username, password_hash, role, full_name) VALUES ('admin', 'x', 'camp_administrator', 'Admin')`).run().lastInsertRowid;
  });
  afterEach(() => db.close());

  it('imports new responses with the full registration profile and a valid audit trail', () => {
    const result = sync([response(), response({ ts: serial(2026, 6, 2), first: 'Sipho', last: 'Dlamini' })]);

    expect(result).toMatchObject({ success: true, rowsRead: 2, imported: 2, alreadySynced: 0, matchedExisting: 0, invalid: [], changedInSheet: [] });
    expect(patientCount()).toBe(2);

    const patient = db.prepare(`SELECT * FROM patients WHERE first_name = 'Thandi'`).get();
    expect(patient).toMatchObject({ last_name: 'Nkosi', date_of_birth: '2012-05-14', primary_diagnosis: 'HIV', camp_session_date: '2026-06-29', known_allergies: 'Peanuts, Penicillin', created_by: adminId });
    const notes = JSON.parse(patient.medical_notes);
    expect(notes).toMatchObject({
      caregiverName: 'Mrs Nkosi',
      caregiverCell: '821234567',
      emergencyContactName: 'Aunt Zodwa',
      currentMedication: ['Efavirenz 600mg', 'Cotrimoxazole'],
      source: 'google_sheet',
    });
    expect(notes.consent).toMatchObject({ consentToDisclosure: true, source: 'google_form', guardianSignature: null });

    const audit = db.prepare(`SELECT action_type, details FROM audit_log WHERE target_table = 'patients'`).all();
    expect(audit).toHaveLength(2);
    expect(audit[0]).toEqual({ action_type: 'CREATE', details: 'Imported from Google Sheet "Form Responses 1", row 2' });
    expect(createAuditLogger(db).verifyChain().valid).toBe(true);
  });

  it('pressing Sync again does not duplicate anything', () => {
    const rows = [response(), response({ ts: serial(2026, 6, 2), first: 'Sipho', last: 'Dlamini' })];
    sync(rows);
    const second = sync(rows);
    const third = sync(rows);

    expect(second).toMatchObject({ imported: 0, alreadySynced: 2, matchedExisting: 0 });
    expect(third).toMatchObject({ imported: 0, alreadySynced: 2 });
    expect(patientCount()).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sheet_sync_rows').get().n).toBe(2);
  });

  it('only imports the rows added since the last sync', () => {
    const first = response();
    sync([first]);
    const result = sync([first, response({ ts: serial(2026, 6, 3), first: 'Lerato', last: 'Mokoena' })]);

    expect(result).toMatchObject({ imported: 1, alreadySynced: 1 });
    expect(patientCount()).toBe(2);
  });

  it('treats the same child submitted twice on the Form as one child', () => {
    const result = sync([response({ ts: serial(2026, 6, 1) }), response({ ts: serial(2026, 6, 5), first: ' thandi ', last: 'NKOSI' })]);

    expect(result).toMatchObject({ imported: 1, matchedExisting: 1 });
    expect(patientCount()).toBe(1);
  });

  it('does not duplicate a child that was already registered in the app', () => {
    createPatientProfile(db, { firstName: 'Thandi', surname: 'Nkosi', dateOfBirth: '2012-05-14', campSessionDate: '2026-06-29', createdByUserId: adminId });
    const result = sync([response()]);

    expect(result).toMatchObject({ imported: 0, matchedExisting: 1 });
    expect(patientCount()).toBe(1);
    // ...and remembers it, so the next sync is a cheap no-op
    expect(sync([response()])).toMatchObject({ alreadySynced: 1, matchedExisting: 0 });
  });

  it('imports a same-named child for a different camp session', () => {
    createPatientProfile(db, { firstName: 'Thandi', surname: 'Nkosi', dateOfBirth: '2012-05-14', campSessionDate: '2025-06-30', createdByUserId: adminId });
    expect(sync([response()])).toMatchObject({ imported: 1 });
    expect(patientCount()).toBe(2);
  });

  it('keeps two different children who were submitted in the same second', () => {
    const ts = serial(2026, 6, 1, 0.25);
    const rows = [response({ ts, first: 'Ayanda', last: 'Zulu' }), response({ ts, first: 'Bongani', last: 'Zulu', dob: serial(2010, 1, 2) })];

    expect(sync(rows)).toMatchObject({ imported: 2 });
    expect(sync(rows)).toMatchObject({ imported: 0, alreadySynced: 2 });
    expect(patientCount()).toBe(2);
  });

  it('flags bad rows with their sheet row number and still imports the good ones', () => {
    const result = sync([
      response({ ts: serial(2026, 6, 1), first: 'Good', last: 'Row' }),
      response({ ts: serial(2026, 6, 2), first: '', last: 'NoName' }),
      response({ ts: serial(2026, 6, 3), first: 'No', last: 'Consent', consent: '' }),
      response({ ts: serial(2026, 6, 4), first: 'Bad', last: 'Date', dob: '03/04/2012' }),
      response({ ts: serial(2026, 6, 5), first: 'Future', last: 'Baby', dob: serial(2027, 1, 1) }),
    ]);

    expect(result.imported).toBe(1);
    expect(result.invalid).toEqual([
      { rowNumber: 3, reasons: ["Child's name is missing"] },
      { rowNumber: 4, reasons: ['Consent to disclosure was not given'] },
      { rowNumber: 5, reasons: [expect.stringContaining('ambiguous')] },
      { rowNumber: 6, reasons: ['Date of birth is in the future'] },
    ]);
    expect(patientCount()).toBe(1);
  });

  it('imports a flagged row once it has been fixed in the sheet', () => {
    const ts = serial(2026, 6, 4);
    expect(sync([response({ ts, dob: '03/04/2012' })]).imported).toBe(0);
    expect(sync([response({ ts, dob: serial(2012, 4, 3) })])).toMatchObject({ imported: 1, invalid: [] });
  });

  it('reports, but does not apply, edits made to a row after it was imported', () => {
    const ts = serial(2026, 6, 1, 0.5);
    sync([response({ ts, allergies: 'Peanuts' })]);

    const result = sync([response({ ts, allergies: 'Peanuts, Penicillin' })]);

    expect(result).toMatchObject({ imported: 0, alreadySynced: 1, changedInSheet: [2] });
    expect(patientCount()).toBe(1);
    expect(db.prepare('SELECT known_allergies FROM patients').get().known_allergies).toBe('Peanuts');
  });

  it('ignores extra staff columns when deciding whether a row changed', () => {
    const ts = serial(2026, 6, 1, 0.5);
    sync([response({ ts })]);
    const result = applySheetValues(db, { ...CONTEXT, syncedByUserId: adminId, values: [[...HEADERS, 'Checked by'], [...response({ ts }), 'Nurse Sam']] });

    expect(result.changedInSheet).toEqual([]);
    expect(result.ignoredColumns).toEqual(['Checked by']);
  });

  it('survives a corrected child name without creating a second record', () => {
    const ts = serial(2026, 6, 1, 0.5);
    sync([response({ ts, first: 'Jhon', last: 'Smith' })]);
    const result = sync([response({ ts, first: 'John', last: 'Smith' })]);

    expect(result).toMatchObject({ imported: 0, alreadySynced: 1, changedInSheet: [2] });
    expect(patientCount()).toBe(1);
  });

  it('rejects a sheet missing a required column without touching the database', () => {
    expect(() => applySheetValues(db, { ...CONTEXT, syncedByUserId: adminId, values: [['Timestamp', "Child's Name"], [1, 'A']] }))
      .toThrow(/missing required column\(s\): Surname, Date of birth, Consent to disclosure/);
    expect(patientCount()).toBe(0);
  });

  it('rolls everything back if any insert fails mid-sync', () => {
    const rows = [response({ first: 'First', last: 'Ok' }), response({ ts: serial(2026, 6, 2), first: 'Second', last: 'Boom' })];
    db.exec(`CREATE TRIGGER boom BEFORE INSERT ON patients WHEN NEW.last_name = 'Boom' BEGIN SELECT RAISE(ABORT, 'disk error'); END;`);

    expect(() => sync(rows)).toThrow('disk error');
    expect(patientCount()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sheet_sync_rows').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n).toBe(0);
  });

  it('accepts a header-only sheet', () => {
    expect(sync([])).toMatchObject({ success: true, rowsRead: 0, imported: 0 });
  });

  it('requires a valid session date and a real database user', () => {
    expect(() => sync([response()], { campSessionDate: 'tomorrow' })).toThrow('Choose a valid camp session date');
    expect(() => sync([response()], { syncedByUserId: 'usr-ghost-01' })).toThrow('No active database user');
    expect(patientCount()).toBe(0);
  });

  describe('runGoogleSheetSync (network layer injected)', () => {
    const env = { GOOGLE_SHEET_ID: 'https://docs.google.com/spreadsheets/d/abc123_-XYZ/edit#gid=0', GOOGLE_SERVICE_ACCOUNT_FILE: 'key.json' };
    const run = (readValues) => runGoogleSheetSync(db, { env, userDataDir: '/tmp/none', syncedByUserId: adminId, campSessionDate: '2026-06-29', today: '2026-10-02', readValues });

    it('syncs, logs success, and reports status', async () => {
      const result = await run(async (config) => {
        expect(config.spreadsheetId).toBe('abc123_-XYZ');
        expect(config.sheetName).toBe('Form Responses 1');
        return [HEADERS, response()];
      });
      expect(result.imported).toBe(1);

      const status = getSheetSyncStatus(db, { env, userDataDir: '/tmp/none' });
      expect(status).toMatchObject({ configured: true, lastSync: { imported: 1, rowsRead: 1 }, lastAttempt: { status: 'success' } });
    });

    it('leaves local data untouched and logs the failure when Google is unreachable', async () => {
      sync([response({ first: 'Existing', last: 'Child' })]);

      await expect(run(async () => { const e = new Error("Couldn't reach Google."); e.code = 'OFFLINE'; throw e; })).rejects.toThrow("Couldn't reach Google");

      expect(patientCount()).toBe(1);
      expect(getSheetSyncStatus(db, { env, userDataDir: '/tmp/none' }).lastAttempt).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('reach Google') });
    });

    it('explains when sync has not been configured on this laptop', async () => {
      await expect(runGoogleSheetSync(db, { env: {}, userDataDir: '/tmp/none', syncedByUserId: adminId, campSessionDate: '2026-06-29' }))
        .rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
      expect(getSheetSyncStatus(db, { env: {}, userDataDir: '/tmp/none' }).configured).toBe(false);
    });
  });
});

describe('migrations', () => {
  it('upgrades an existing v2 database in place and is safe to re-run', () => {
    const db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../electron/database/schema.sql'), 'utf8'));
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v).toBe(2);

    applyMigrations(db);
    applyMigrations(db);

    expect(db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v).toBe(4);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name IN ('sheet_sync_rows','sheet_sync_log') ORDER BY name`).all().map((r) => r.name))
      .toEqual(['sheet_sync_log', 'sheet_sync_rows']);
    db.close();
  });
});
