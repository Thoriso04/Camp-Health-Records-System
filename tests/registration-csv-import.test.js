const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { applyMigrations } = require('../electron/database/database');
const { decodeCsvBytes, parseCsvToValues, previewRegistrationCsv, importRegistrationCsv } = require('../electron/services/registrationCsvImport');
const { applySheetValues, getSheetSyncStatus } = require('../electron/services/sheetSyncService');
const { createAuditLogger } = require('../electron/database/auditLog');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PHOTO_A = `data:image/png;base64,${PNG_1X1}`;
const PHOTO_B = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('second photo')]).toString('base64')}`;

const HEADERS = [
  'Timestamp', "Child's Name", 'Surname', 'Date of birth', 'Sex', 'Diagnosis', 'Allergies',
  'Current medication', 'Parent/Primary Caregiver Name & Surname', 'Parent/Caregiver cell number',
  'Consent to disclosure', 'Photo',
];

// What a Google Sheets "Download as CSV" looks like for an en-ZA sheet:
// text timestamps, yyyy/mm/dd dates, phone numbers with their leading zero.
function row({ ts = '2026/06/01 12:00:00', first = 'Thandi', last = 'Nkosi', dob = '2012/05/14', allergies = 'Peanuts, Penicillin', cell = '0821234567', consent = 'I consent', photo = '' } = {}) {
  return [ts, first, last, dob, 'Female', 'HIV', allergies, 'Efavirenz 600mg\nCotrimoxazole', 'Mrs Nkosi', cell, consent, photo];
}

const quote = (cell) => (/[",\n\r;]/.test(cell) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell));
const toCsv = (rows, headers = HEADERS) => [headers, ...rows].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
const csvBytes = (rows, headers) => Buffer.from(toCsv(rows, headers), 'utf8');

const SESSION = '2026-06-29';

describe('registration CSV import', () => {
  let db;
  let adminId;
  const run = (rows, extra = {}) => importRegistrationCsv(db, {
    csvBytes: csvBytes(rows), fileName: 'Camp Registration (Responses).csv', campSessionDate: SESSION,
    importedByUserId: adminId, today: '2026-10-02', ...extra,
  });
  const preview = (rows, extra = {}) => previewRegistrationCsv(db, {
    csvBytes: csvBytes(rows), fileName: 'x.csv', campSessionDate: SESSION, today: '2026-10-02', ...extra,
  });
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const notesOf = (first) => JSON.parse(db.prepare('SELECT medical_notes FROM patients WHERE first_name = ?').get(first).medical_notes);

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../electron/database/schema.sql'), 'utf8'));
    applyMigrations(db);
    adminId = db.prepare(`INSERT INTO users (username, password_hash, role, full_name) VALUES ('admin', 'x', 'camp_administrator', 'Admin')`).run().lastInsertRowid;
  });
  afterEach(() => db.close());

  describe('reading the file', () => {
    it('decodes UTF-8 (with and without BOM), UTF-16 and Windows-1252', () => {
      const text = 'Name\nZoë\n';
      expect(decodeCsvBytes(Buffer.from(text, 'utf8'))).toBe(text);
      expect(decodeCsvBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]))).toBe(text);
      expect(decodeCsvBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))).toBe(text);
      expect(decodeCsvBytes(Buffer.from([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x5a, 0x6f, 0xeb, 0x0a]))).toBe(text); // 0xEB = ë in Windows-1252
    });

    it('accepts Uint8Array and ArrayBuffer, which is what arrives over Electron IPC', () => {
      const bytes = Buffer.from('a,b\n1,2\n');
      expect(decodeCsvBytes(new Uint8Array(bytes))).toBe('a,b\n1,2\n');
      expect(decodeCsvBytes(new Uint8Array(bytes).buffer)).toBe('a,b\n1,2\n');
    });

    it('handles quoted commas, quotes and line breaks, and semicolon-separated files', () => {
      expect(parseCsvToValues('a,b\r\n"x, ""y""","line1\nline2"\r\n')).toEqual([['a', 'b'], ['x, "y"', 'line1\nline2']]);
      expect(parseCsvToValues('a;b;c\n1;2;3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    });

    it('rejects empty, damaged and oversized files with a plain message', () => {
      expect(() => parseCsvToValues('')).toThrow(/empty/);
      expect(() => parseCsvToValues('a,b\n"unterminated,2\n')).toThrow(/damaged/);
      expect(() => decodeCsvBytes(Buffer.alloc(11 * 1024 * 1024))).toThrow(/too large/);
    });
  });

  describe('importing', () => {
    it('imports children from a Google-style export, keeping phone numbers and text dates intact', () => {
      const result = run([row(), row({ ts: '2026/06/02 09:15:00', first: 'Sipho', last: 'Dlamini', dob: '2013/01/30', cell: '0731112222' })]);

      expect(result).toMatchObject({ success: true, rowsRead: 2, imported: 2, alreadySynced: 0, matchedExisting: 0, invalid: [], changedInSheet: [] });
      const thandi = db.prepare(`SELECT * FROM patients WHERE first_name = 'Thandi'`).get();
      expect(thandi).toMatchObject({ date_of_birth: '2012-05-14', camp_session_date: SESSION, known_allergies: 'Peanuts, Penicillin', created_by: adminId });
      expect(notesOf('Thandi')).toMatchObject({ caregiverCell: '0821234567', currentMedication: ['Efavirenz 600mg', 'Cotrimoxazole'], source: 'csv_file' });
    });

    it('audits each child with the file name and keeps the audit chain valid', () => {
      run([row()], { fileName: 'June\u0007 camp.csv' });
      const audit = db.prepare(`SELECT action_type, details FROM audit_log WHERE target_table = 'patients'`).all();
      expect(audit).toEqual([{ action_type: 'CREATE', details: 'Imported from CSV file "June camp.csv", row 2' }]);
      expect(createAuditLogger(db).verifyChain().valid).toBe(true);
    });

    it('flags ambiguous dates, missing consent and missing names instead of guessing or importing', () => {
      const result = run([
        row({ dob: '03/04/2012' }),
        row({ ts: '2026/06/02 10:00:00', first: 'Sipho', consent: '' }),
        row({ ts: '2026/06/03 10:00:00', first: '' }),
        row({ ts: '2026/06/04 10:00:00', first: 'Lerato', dob: '25/12/2012' }), // unambiguous day-first
      ]);
      expect(result.imported).toBe(1);
      expect(result.invalid.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
      expect(result.invalid[0].reasons[0]).toMatch(/ambiguous/);
      expect(result.invalid[1].reasons[0]).toMatch(/Consent/);
      expect(db.prepare(`SELECT date_of_birth FROM patients WHERE first_name = 'Lerato'`).get().date_of_birth).toBe('2012-12-25');
    });

    it('keeps row numbers aligned with the spreadsheet when the file has blank lines', () => {
      const text = toCsv([row({ first: '' }), row({ ts: '2026/06/02 10:00:00', first: 'Sipho' })]).replace('\r\n', '\r\n,,,,,,,,,,,\r\n');
      const result = importRegistrationCsv(db, { csvBytes: Buffer.from(text), fileName: 'a.csv', campSessionDate: SESSION, importedByUserId: adminId, today: '2026-10-02' });
      expect(result.invalid.map((r) => r.rowNumber)).toEqual([3]);
    });

    it('rejects the wrong kind of file and bad inputs without writing anything', () => {
      expect(() => importRegistrationCsv(db, { csvBytes: Buffer.from('FirstName,LastName\nA,B\n'), fileName: 'roster.csv', campSessionDate: SESSION, importedByUserId: adminId }))
        .toThrow(/missing required column/);
      expect(() => run([row()], { campSessionDate: '2026-13-45' })).toThrow(/valid camp session date/);
      expect(() => run([row()], { importedByUserId: 9999 })).toThrow(/No active database user/);
      expect(count('patients')).toBe(0);
      expect(count('sheet_sync_rows')).toBe(0);
    });
  });

  describe('never duplicates children', () => {
    it('importing the same file twice adds nothing the second time', () => {
      const rows = [row(), row({ ts: '2026/06/02 09:15:00', first: 'Sipho' })];
      run(rows, { photoFiles: { 'x.png': PHOTO_A } });
      const again = run(rows, { fileName: 'Camp Registration (Responses) (1).csv' });
      expect(again).toMatchObject({ imported: 0, alreadySynced: 2, matchedExisting: 0 });
      expect(count('patients')).toBe(2);
      expect(count('sheet_sync_rows')).toBe(2);
    });

    it('a later, bigger download only adds the new responses', () => {
      run([row()]);
      const second = run([row(), row({ ts: '2026/06/03 08:00:00', first: 'Lerato' })], { fileName: 'newer.csv' });
      expect(second).toMatchObject({ imported: 1, alreadySynced: 1 });
      expect(count('patients')).toBe(2);
    });

    it('recognises children already brought in by the Google API sync', () => {
      const serial = (y, m, d, f = 0) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000 + f;
      applySheetValues(db, {
        values: [HEADERS, [serial(2026, 6, 1, 0.5), 'Thandi', 'Nkosi', serial(2012, 5, 14), 'Female', 'HIV', '', '', 'Mrs Nkosi', '821234567', 'I consent', '']],
        spreadsheetId: 'real-sheet-id', sheetName: 'Form Responses 1', campSessionDate: SESSION, syncedByUserId: adminId, today: '2026-10-02',
      });
      const result = run([row()]);
      expect(result).toMatchObject({ imported: 0, matchedExisting: 1 });
      expect(count('patients')).toBe(1);
    });

    it('imports a child submitted twice in the same file only once', () => {
      const rows = [row(), row({ ts: '2026/06/01 12:30:00', first: 'thandi', last: 'NKOSI' })];
      const shown = preview(rows);
      const result = run(rows);
      expect(result).toMatchObject({ imported: 1, matchedExisting: 1 });
      expect(shown).toMatchObject({ imported: 1, matchedExisting: 1 });
      expect(count('patients')).toBe(1);
      const ledger = db.prepare('SELECT patient_id, outcome FROM sheet_sync_rows ORDER BY sheet_row_number').all();
      expect(ledger.map((r) => r.outcome)).toEqual(['imported', 'matched_existing']);
      expect(ledger[0].patient_id).toBe(ledger[1].patient_id);
    });

    it('reports (but does not apply) a response edited after import', () => {
      run([row({ allergies: 'Peanuts' })]);
      const result = run([row({ allergies: 'Peanuts, Latex' })]);
      expect(result).toMatchObject({ imported: 0, alreadySynced: 1, changedInSheet: [2] });
      expect(db.prepare('SELECT known_allergies FROM patients').get().known_allergies).toBe('Peanuts');
    });
  });

  describe('photos', () => {
    it('stores a matched photo, and leaves everyone else blank', () => {
      const result = run(
        [row({ photo: 'thandi.png' }), row({ ts: '2026/06/02 09:00:00', first: 'Sipho', photo: '' }), row({ ts: '2026/06/03 09:00:00', first: 'Lerato', photo: 'lerato.jpg' })],
        { photoFiles: { 'Thandi.PNG': PHOTO_A, 'lerato.jpg': PHOTO_B } }
      );
      expect(result).toMatchObject({ imported: 3, photosAdded: 2, photoWarnings: [] });
      expect(notesOf('Thandi').photoDataUrl).toBe(PHOTO_A);
      expect(notesOf('Sipho').photoDataUrl).toBeNull();
      expect(notesOf('Lerato').photoDataUrl).toBe(PHOTO_B);
    });

    it('leaves the photo blank when the sheet has no photo column at all', () => {
      const headers = HEADERS.slice(0, -1);
      const rows = [row()].map((r) => r.slice(0, -1));
      const result = importRegistrationCsv(db, { csvBytes: csvBytes(rows, headers), fileName: 'a.csv', campSessionDate: SESSION, importedByUserId: adminId, photoFiles: { 'thandi.png': PHOTO_A }, today: '2026-10-02' });
      expect(result).toMatchObject({ imported: 1, photosAdded: 0, photoWarnings: [] });
      expect(notesOf('Thandi').photoDataUrl).toBeNull();
    });

    it('never attaches a photo just because a file name resembles the child', () => {
      run([row()], { photoFiles: { 'Thandi Nkosi.png': PHOTO_A } }); // cell is blank
      expect(notesOf('Thandi').photoDataUrl).toBeNull();
    });

    it('still imports the child, with a blank photo and a warning, when the photo is missing, a link, or corrupt', () => {
      const result = run(
        [
          row({ photo: 'gone.jpg' }),
          row({ ts: '2026/06/02 09:00:00', first: 'Sipho', photo: 'https://drive.google.com/open?id=1abc' }),
          row({ ts: '2026/06/03 09:00:00', first: 'Lerato', photo: 'broken.png' }),
        ],
        { photoFiles: { 'broken.png': 'data:image/png;base64,AAAA' } }
      );
      expect(result).toMatchObject({ imported: 3, photosAdded: 0 });
      expect(result.photoWarnings.map((w) => w.rowNumber)).toEqual([2, 3, 4]);
      for (const name of ['Thandi', 'Sipho', 'Lerato']) expect(notesOf(name).photoDataUrl).toBeNull();
    });

    it('accepts an image embedded in the cell', () => {
      run([row({ photo: PHOTO_A })]);
      expect(notesOf('Thandi').photoDataUrl).toBe(PHOTO_A);
    });

    it('does not warn about the photos of children who were already imported', () => {
      run([row({ photo: 'thandi.png' })], { photoFiles: { 'thandi.png': PHOTO_A } });
      const again = run([row({ photo: 'thandi.png' })]); // photos not chosen this time
      expect(again).toMatchObject({ alreadySynced: 1, photosAdded: 0, photoWarnings: [] });
      expect(notesOf('Thandi').photoDataUrl).toBe(PHOTO_A);
    });

    it('also applies when the Google API sync meets a photo column holding a Drive link', () => {
      const result = applySheetValues(db, {
        values: [HEADERS, ['2026/06/01 12:00:00', 'Thandi', 'Nkosi', '2012/05/14', 'Female', 'HIV', '', '', 'Mrs Nkosi', '0821234567', 'I consent', 'https://drive.google.com/open?id=1abc']],
        spreadsheetId: 'real-sheet-id', sheetName: 'Form Responses 1', campSessionDate: SESSION, syncedByUserId: adminId, today: '2026-10-02',
      });
      expect(result).toMatchObject({ imported: 1, photosAdded: 0 });
      expect(result.photoWarnings).toHaveLength(1);
      expect(notesOf('Thandi')).toMatchObject({ photoDataUrl: null, source: 'google_sheet' });
    });

    it('imports nothing at all if the photo list is absurd', () => {
      const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`p${i}.png`, PHOTO_A]));
      expect(() => run([row()], { photoFiles: many })).toThrow(/Too many photo files/);
      expect(count('patients')).toBe(0);
      expect(count('sheet_sync_rows')).toBe(0);
    });
  });

  describe('preview', () => {
    it('writes nothing at all', () => {
      const before = ['patients', 'sheet_sync_rows', 'sheet_sync_log', 'audit_log'].map(count);
      preview([row({ photo: 'thandi.png' }), row({ ts: '2026/06/02 09:00:00', first: 'Sipho', dob: '03/04/2012' })], { photoFiles: { 'thandi.png': PHOTO_A } });
      expect(['patients', 'sheet_sync_rows', 'sheet_sync_log', 'audit_log'].map(count)).toEqual(before);
    });

    it('says whether the file has a recognisable Photo column, so staff learn why photos did not attach', () => {
      expect(preview([row()]).photoColumnFound).toBe(true);
      const renamed = HEADERS.map((h) => (h === 'Photo' ? 'Pic' : h));
      const shown = previewRegistrationCsv(db, { csvBytes: csvBytes([row({ photo: 'a.png' })], renamed), fileName: 'x.csv', campSessionDate: SESSION, today: '2026-10-02' });
      expect(shown.photoColumnFound).toBe(false);
      expect(shown.ignoredColumns).toContain('Pic');
    });

    it('predicts exactly what the import then does, row by row', () => {
      const rows = [
        row({ photo: 'thandi.png' }),
        row({ ts: '2026/06/02 09:00:00', first: 'Sipho', dob: '03/04/2012' }),
        row({ ts: '2026/06/03 09:00:00', first: 'Lerato', photo: 'nope.jpg' }),
        row({ ts: '2026/06/04 09:00:00', first: 'Lerato', photo: 'nope.jpg' }),
      ];
      run([row({ ts: '2026/06/03 09:00:00', first: 'Lerato' })]); // Lerato already in the database
      const options = { photoFiles: { 'thandi.png': PHOTO_A } };

      const shown = preview(rows, options);
      const done = run(rows, options);

      for (const key of ['rowsRead', 'imported', 'alreadySynced', 'matchedExisting', 'photosAdded', 'changedInSheet', 'invalid', 'photoWarnings']) {
        expect(shown[key]).toEqual(done[key]);
      }
      expect(shown.rows.map((r) => r.outcome)).toEqual(['import', 'invalid', 'already_synced', 'matched_existing']);
      expect(shown.rows[0]).toMatchObject({ name: 'Thandi Nkosi', dateOfBirth: '2012-05-14', photo: { status: 'matched' } });
      expect(shown.rows[1].reasons[0]).toMatch(/ambiguous/);
    });
  });

  describe('logging', () => {
    it('records CSV imports without touching the Google "last sync" status', () => {
      run([row()]);
      expect(db.prepare('SELECT source, status, imported FROM sheet_sync_log').all()).toEqual([{ source: 'csv_file', status: 'success', imported: 1 }]);
      expect(getSheetSyncStatus(db, { userDataDir: '/nonexistent', env: {} })).toMatchObject({ lastSync: null, lastAttempt: null });
    });

    it('records a failed import, still as a CSV event', () => {
      expect(() => run([row()], { campSessionDate: 'bad' })).toThrow();
      expect(db.prepare('SELECT source, status FROM sheet_sync_log').all()).toEqual([{ source: 'csv_file', status: 'failed' }]);
    });
  });

  describe('migration 004', () => {
    it('upgrades a v3 database, keeping its existing log rows labelled as Google syncs', () => {
      const old = new Database(':memory:');
      old.exec(fs.readFileSync(path.join(__dirname, '../electron/database/schema.sql'), 'utf8'));
      old.exec(fs.readFileSync(path.join(__dirname, '../electron/database/migrations/003_sheet_sync.sql'), 'utf8'));
      old.prepare('INSERT INTO schema_version (version) VALUES (3)').run();
      old.prepare(`INSERT INTO sheet_sync_log (status, rows_read, imported) VALUES ('success', 5, 5)`).run();

      applyMigrations(old);
      applyMigrations(old);

      expect(old.prepare('SELECT MAX(version) AS v FROM schema_version').get().v).toBe(4);
      expect(old.prepare('SELECT source, rows_read FROM sheet_sync_log').all()).toEqual([{ source: 'google_sheet', rows_read: 5 }]);
      expect(() => old.prepare(`INSERT INTO sheet_sync_log (status, source) VALUES ('success', 'carrier_pigeon')`).run()).toThrow();
      old.close();
    });
  });
});
