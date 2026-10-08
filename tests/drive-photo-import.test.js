const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { applyMigrations } = require('../electron/database/database');
const { buildPhotoIndex, resolvePhoto, extractDriveFileIds, DRIVE_KEY_PREFIX } = require('../electron/services/registrationPhotos');
const { applySheetValues, previewSheetValues, previewGoogleSheet, runGoogleSheetSync } = require('../electron/services/sheetSyncService');
const { importRegistrationCsv, previewRegistrationCsv } = require('../electron/services/registrationCsvImport');
const { findPatient } = require('../electron/services/patientQueryService');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const png = `data:image/png;base64,${PNG_1X1}`;
const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF fake body')]).toString('base64')}`;

const ID_A = '1AbCdEfGhIjKlMnOp';
const ID_B = '2ZyXwVuTsRqPoNmLk';
const link = (id) => `https://drive.google.com/open?id=${id}`;

describe('Drive links in the photo column', () => {
  describe('extractDriveFileIds', () => {
    it('reads the links a Google Form upload question writes', () => {
      expect(extractDriveFileIds(link(ID_A))).toEqual([ID_A]);
      expect(extractDriveFileIds(`${link(ID_A)}, ${link(ID_B)}`)).toEqual([ID_A, ID_B]);
      expect(extractDriveFileIds(`${link(ID_A)},${link(ID_A)}`)).toEqual([ID_A]);
      expect(extractDriveFileIds(`https://drive.google.com/file/d/${ID_A}/view?usp=sharing`)).toEqual([ID_A]);
    });

    it('ignores anything that is not a Drive link with a plausible id', () => {
      for (const cell of ['', 'thandi.jpg', 'https://example.com/open?id=' + ID_A, 'https://drive.google.com.evil.com/open?id=' + ID_A,
        'https://drive.google.com/open?id=short', 'https://drive.google.com/open', 'javascript:alert(1)', null, undefined]) {
        expect(extractDriveFileIds(cell)).toEqual([]);
      }
    });
  });

  describe('resolvePhoto', () => {
    it('stays blank, and says what to download, until the photo has been fetched', () => {
      expect(resolvePhoto(link(ID_A), buildPhotoIndex({}))).toMatchObject({ dataUrl: null, status: 'drive_pending', driveFileId: ID_A });
      // a photo fetched for a different file is never used
      expect(resolvePhoto(link(ID_A), buildPhotoIndex({ [`${DRIVE_KEY_PREFIX}${ID_B}`]: png }))).toMatchObject({ dataUrl: null, status: 'drive_pending' });
    });

    it('uses the downloaded photo that matches the file id', () => {
      const index = buildPhotoIndex({ [`${DRIVE_KEY_PREFIX}${ID_A}`]: png, [`${DRIVE_KEY_PREFIX}${ID_B}`]: jpeg });
      expect(resolvePhoto(link(ID_A), index)).toMatchObject({ dataUrl: png, status: 'drive', driveFileId: ID_A });
      expect(resolvePhoto(link(ID_B), index)).toMatchObject({ dataUrl: jpeg, status: 'drive' });
    });

    it('uses the first upload and says so when a parent uploaded several', () => {
      const index = buildPhotoIndex({ [`${DRIVE_KEY_PREFIX}${ID_A}`]: png, [`${DRIVE_KEY_PREFIX}${ID_B}`]: jpeg });
      const result = resolvePhoto(`${link(ID_A)}, ${link(ID_B)}`, index);
      expect(result).toMatchObject({ dataUrl: png, status: 'drive' });
      expect(result.message).toMatch(/2 files were uploaded/);
    });

    it('re-validates a downloaded photo instead of trusting the caller', () => {
      const index = buildPhotoIndex({ [`${DRIVE_KEY_PREFIX}${ID_A}`]: 'data:image/png;base64,AAAA' });
      expect(resolvePhoto(link(ID_A), index)).toMatchObject({ dataUrl: null, status: 'invalid' });
    });

    it('does not let a "drive:" entry be matched by file name, or a file name by id', () => {
      const index = buildPhotoIndex({ [`${DRIVE_KEY_PREFIX}${ID_A}`]: png, 'thandi.png': jpeg });
      expect(resolvePhoto(`drive:${ID_A}`, index)).toMatchObject({ dataUrl: null, status: 'not_found' });
      expect(resolvePhoto(link('thandi.png'), index)).toMatchObject({ dataUrl: null, status: 'link' });
    });

    it('still refuses links that are not Drive uploads', () => {
      expect(resolvePhoto('https://example.com/photo.jpg')).toMatchObject({ dataUrl: null, status: 'link' });
    });
  });
});

describe('importing a Form with a photo upload question', () => {
  const HEADERS = [
    'Timestamp', "Child's Name", 'Surname', 'Date of birth', 'Diagnosis', 'Consent to disclosure',
    'Photo of child (upload a clear photo of the child\u2019s face)',
  ];
  const serial = (y, m, d, f = 0) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000 + f;
  const row = (first, photo, ts = serial(2026, 6, 1, 0.5)) => [ts, first, 'Nkosi', serial(2012, 5, 14), 'HIV', 'I consent', photo];
  const CONTEXT = { spreadsheetId: 'sheet-1', sheetName: 'Form Responses 1', campSessionDate: '2027-01-10', today: '2026-10-02' };

  let db;
  let adminId;
  const photoOf = (first) => JSON.parse(db.prepare('SELECT medical_notes FROM patients WHERE first_name = ?').get(first).medical_notes).photoDataUrl;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../electron/database/schema.sql'), 'utf8'));
    applyMigrations(db);
    adminId = db.prepare(`INSERT INTO users (username, password_hash, role, full_name) VALUES ('admin', 'x', 'camp_administrator', 'Admin')`).run().lastInsertRowid;
  });
  afterEach(() => db.close());

  it('recognises the upload question column even with a long hint in its title', () => {
    const preview = previewSheetValues(db, { ...CONTEXT, values: [HEADERS, row('Thandi', link(ID_A))] });
    expect(preview.photoColumnFound).toBe(true);
    expect(preview.ignoredColumns).toEqual([]);
  });

  it('lists exactly the Drive photos that still need downloading, for children about to be added', () => {
    const values = [
      HEADERS,
      row('Thandi', link(ID_A), serial(2026, 6, 1, 0.1)),
      row('Sipho', `${link(ID_B)}`, serial(2026, 6, 1, 0.2)),
      row('Zodwa', '', serial(2026, 6, 1, 0.3)),                           // no photo: nothing to fetch
      row('Thandi', link(ID_A), serial(2026, 6, 1, 0.4)),                  // submitted twice: matched, not fetched twice
    ];
    const preview = previewSheetValues(db, { ...CONTEXT, values });
    expect(preview.drivePhotoIds).toEqual([ID_A, ID_B]);
    expect(preview.rows[0].photo).toMatchObject({ status: 'drive_pending' });
    expect(preview.rows[3].outcome).toBe('matched_existing');
  });

  it('does not ask for photos of children who are already in CHRS', () => {
    applySheetValues(db, { ...CONTEXT, values: [HEADERS, row('Thandi', '')], syncedByUserId: adminId });
    const preview = previewSheetValues(db, { ...CONTEXT, values: [HEADERS, row('Thandi', link(ID_A), serial(2026, 7, 1))] });
    expect(preview.rows[0].outcome).toBe('matched_existing');
    expect(preview.drivePhotoIds).toEqual([]);
  });

  it('stores the downloaded photo with the child; the preview and the import agree', () => {
    const values = [HEADERS, row('Thandi', link(ID_A), serial(2026, 6, 1, 0.1)), row('Sipho', link(ID_B), serial(2026, 6, 1, 0.2))];
    const photoFiles = { [`${DRIVE_KEY_PREFIX}${ID_A}`]: png }; // Sipho's could not be downloaded

    const preview = previewSheetValues(db, { ...CONTEXT, values, photoFiles });
    const result = applySheetValues(db, { ...CONTEXT, values, photoFiles, syncedByUserId: adminId });

    expect(preview.photosAdded).toBe(1);
    expect(result.photosAdded).toBe(1);
    expect(photoOf('Thandi')).toBe(png);
    expect(photoOf('Sipho')).toBeNull(); // blank, never someone else's photo
    expect(result.photoWarnings).toEqual([{ rowNumber: 3, message: expect.stringMatching(/not been downloaded/) }]);
    expect(preview.photoWarnings).toEqual(result.photoWarnings);
  });

  it('imports the child without a photo when nothing was downloaded (offline or not shared)', () => {
    const result = applySheetValues(db, { ...CONTEXT, values: [HEADERS, row('Thandi', link(ID_A))], syncedByUserId: adminId });
    expect(result.imported).toBe(1);
    expect(photoOf('Thandi')).toBeNull();
  });

  it('works through the CSV import too (a Drive link survives a CSV download)', () => {
    const csv = [
      HEADERS.map((h) => `"${h}"`).join(','),
      `"2026-06-01 12:00:00","Thandi","Nkosi","2012-05-14","HIV","I consent","${link(ID_A)}"`,
    ].join('\r\n');
    const input = { csvBytes: Buffer.from(csv), fileName: 'responses.csv', campSessionDate: '2027-01-10', today: '2026-10-02' };

    const withoutPhotos = previewRegistrationCsv(db, input);
    expect(withoutPhotos.drivePhotoIds).toEqual([ID_A]);

    const photoFiles = { [`${DRIVE_KEY_PREFIX}${ID_A}`]: png };
    expect(previewRegistrationCsv(db, { ...input, photoFiles }).photosAdded).toBe(1);
    importRegistrationCsv(db, { ...input, photoFiles, importedByUserId: adminId });
    expect(photoOf('Thandi')).toBe(png);
  });

  it('shows the photo when the patient is looked up', () => {
    applySheetValues(db, { ...CONTEXT, values: [HEADERS, row('Thandi', link(ID_A))], photoFiles: { [`${DRIVE_KEY_PREFIX}${ID_A}`]: png }, syncedByUserId: adminId });
    applySheetValues(db, { ...CONTEXT, values: [HEADERS, row('Sipho', '', serial(2026, 6, 2))], syncedByUserId: adminId });
    expect(findPatient(db, 'Thandi Nkosi').patient.photoDataUrl).toBe(png);
    expect(findPatient(db, 'Sipho Nkosi').patient.photoDataUrl).toBeNull();
  });

  describe('Google Sheet sync (network layer injected)', () => {
    const env = { GOOGLE_SHEET_ID: 'sheet-1', GOOGLE_SERVICE_ACCOUNT_FILE: 'key.json' };
    const readValues = async () => [HEADERS, row('Thandi', link(ID_A))];

    it('previewGoogleSheet reports the Drive photos and writes nothing', async () => {
      const before = db.prepare('SELECT (SELECT COUNT(*) FROM patients) p, (SELECT COUNT(*) FROM sheet_sync_rows) r, (SELECT COUNT(*) FROM sheet_sync_log) l, (SELECT COUNT(*) FROM audit_log) a').get();
      const preview = await previewGoogleSheet(db, { env, userDataDir: '/tmp/none', campSessionDate: '2027-01-10', today: '2026-10-02', readValues });
      expect(preview.drivePhotoIds).toEqual([ID_A]);
      expect(db.prepare('SELECT (SELECT COUNT(*) FROM patients) p, (SELECT COUNT(*) FROM sheet_sync_rows) r, (SELECT COUNT(*) FROM sheet_sync_log) l, (SELECT COUNT(*) FROM audit_log) a').get()).toEqual(before);
    });

    it('previewGoogleSheet fails clearly when sync is not set up', async () => {
      await expect(previewGoogleSheet(db, { env: {}, userDataDir: '/tmp/none', campSessionDate: '2027-01-10', readValues })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    });

    it('runGoogleSheetSync attaches the photos it is given', async () => {
      const result = await runGoogleSheetSync(db, {
        env, userDataDir: '/tmp/none', syncedByUserId: adminId, campSessionDate: '2027-01-10', today: '2026-10-02', readValues,
        photoFiles: { [`${DRIVE_KEY_PREFIX}${ID_A}`]: png },
      });
      expect(result).toMatchObject({ imported: 1, photosAdded: 1 });
      expect(photoOf('Thandi')).toBe(png);
    });
  });
});
