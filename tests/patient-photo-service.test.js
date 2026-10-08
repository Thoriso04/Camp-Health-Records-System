const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3-multiple-ciphers');
const { applyMigrations } = require('../electron/database/database');
const { setPatientPhoto } = require('../electron/services/patientPhotoService');
const { createPatientProfile } = require('../electron/services/patientProfileService');
const { findPatient } = require('../electron/services/patientQueryService');
const { createAuditLogger } = require('../electron/database/auditLog');
const { MAX_PHOTO_BYTES } = require('../electron/services/registrationPhotos');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const png = `data:image/png;base64,${PNG_1X1}`;
const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF fake body')]).toString('base64')}`;

describe('physician photo changes', () => {
  let db;
  let physicianId;
  let nurseId;
  let adminId;
  let patientId;
  const notesOf = (id = patientId) => JSON.parse(db.prepare('SELECT medical_notes FROM patients WHERE id = ?').get(id).medical_notes);
  const setPhoto = (photoDataUrl, overrides = {}) => setPatientPhoto(db, { patientId, photoDataUrl, userId: physicianId, ...overrides });

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../electron/database/schema.sql'), 'utf8'));
    applyMigrations(db);
    const addUser = (username, role) => db.prepare('INSERT INTO users (username, password_hash, role, full_name) VALUES (?, ?, ?, ?)').run(username, 'x', role, username).lastInsertRowid;
    physicianId = addUser('physician', 'camp_physician');
    nurseId = addUser('nurse', 'camp_nurse');
    adminId = addUser('admin', 'camp_administrator');
    patientId = Number(createPatientProfile(db, {
      firstName: 'Thandi', surname: 'Nkosi', dateOfBirth: '2012-05-14', campSessionDate: '2027-01-10',
      diagnosis: 'HIV', allergies: ['Peanuts'], currentMedication: ['Efavirenz 600mg'], caregiverName: 'Mrs Nkosi',
      consent: { consentToDisclosure: true }, createdByUserId: adminId,
    }).id);
  });
  afterEach(() => db.close());

  it('adds a photo to a child who has none', () => {
    expect(notesOf().photoDataUrl).toBeNull();
    expect(setPhoto(png)).toMatchObject({ success: true, changed: true, action: 'added', photoDataUrl: png });
    expect(notesOf().photoDataUrl).toBe(png);
  });

  it('replaces and removes a photo', () => {
    setPhoto(png);
    expect(setPhoto(jpeg)).toMatchObject({ action: 'replaced' });
    expect(notesOf().photoDataUrl).toBe(jpeg);

    expect(setPhoto(null)).toMatchObject({ action: 'removed', photoDataUrl: null });
    expect(notesOf().photoDataUrl).toBeNull(); // blank, not a placeholder
    expect(setPhoto('')).toMatchObject({ action: 'unchanged' });
  });

  it('changes only the photo; everything else about the child is untouched', () => {
    const before = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
    const notesBefore = notesOf();
    setPhoto(png);
    const after = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);

    for (const column of ['first_name', 'last_name', 'date_of_birth', 'primary_diagnosis', 'known_allergies', 'camp_session_date', 'created_by', 'deleted_at']) {
      expect(after[column]).toEqual(before[column]);
    }
    expect({ ...notesOf(), photoDataUrl: null }).toEqual({ ...notesBefore, photoDataUrl: null });
    expect(notesOf().currentMedication).toEqual(['Efavirenz 600mg']);
  });

  it('does nothing, and writes no audit entry, when the photo is the same', () => {
    setPhoto(png);
    const entries = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
    expect(setPhoto(png)).toMatchObject({ changed: false, action: 'unchanged' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n).toBe(entries);
  });

  describe('who may do it', () => {
    it.each([['nurse'], ['admin']])('refuses the %s role, even though they can edit or import elsewhere', (who) => {
      const userId = who === 'nurse' ? nurseId : adminId;
      expect(() => setPhoto(png, { userId })).toThrow(/Only the camp physician/);
      expect(notesOf().photoDataUrl).toBeNull();
      expect(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action_type = 'UPDATE'`).get().n).toBe(0);
    });

    it('refuses an unknown, missing or disabled user', () => {
      expect(() => setPhoto(png, { userId: 9999 })).toThrow(/No active database user/);
      expect(() => setPhoto(png, { userId: undefined })).toThrow(/No active database user/);
      db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(physicianId);
      expect(() => setPhoto(png)).toThrow(/No active database user/);
    });

    it('accepts the legacy sign-in id the app uses (usr-physician-01)', () => {
      expect(setPhoto(png, { userId: 'usr-physician-01' })).toMatchObject({ action: 'added' });
    });
  });

  describe('what it will store', () => {
    it.each([
      ['svg', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      ['a fake png', 'data:image/png;base64,AAAA'],
      ['html', 'data:text/html;base64,PGgxPmhpPC9oMT4='],
      ['a web link', 'https://example.com/a.jpg'],
      ['plain text', 'hello'],
    ])('rejects %s and leaves the existing photo alone', (_label, bad) => {
      setPhoto(png);
      expect(() => setPhoto(bad)).toThrow(/photo/i);
      expect(notesOf().photoDataUrl).toBe(png);
    });

    it('rejects an oversized photo', () => {
      const big = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(MAX_PHOTO_BYTES + 10)]).toString('base64')}`;
      expect(() => setPhoto(big)).toThrow(/too large/);
    });
  });

  describe('which child', () => {
    it('accepts the id shown on screen as well as the database id', () => {
      expect(setPatientPhoto(db, { patientId: `CAMPER-${String(patientId).padStart(3, '0')}`, photoDataUrl: png, userId: physicianId })).toMatchObject({ action: 'added' });
    });

    it.each([[undefined], [''], ['abc'], ['1; DROP TABLE patients']])('rejects patient id %p', (bad) => {
      expect(() => setPhoto(png, { patientId: bad })).toThrow(/Choose a patient/);
    });

    it('will not touch a patient that does not exist or has been deleted', () => {
      expect(() => setPhoto(png, { patientId: 9999 })).toThrow(/could not be found/);
      db.prepare(`UPDATE patients SET deleted_at = '2026-01-01T00:00:00Z' WHERE id = ?`).run(patientId);
      expect(() => setPhoto(png)).toThrow(/could not be found/);
    });

    it('does not overwrite notes it cannot read', () => {
      db.prepare('UPDATE patients SET medical_notes = ? WHERE id = ?').run('{not json', patientId);
      expect(() => setPhoto(png)).toThrow(/could not be read/);
      expect(db.prepare('SELECT medical_notes FROM patients WHERE id = ?').get(patientId).medical_notes).toBe('{not json');
    });

    it('works for an older record that has no notes at all', () => {
      db.prepare('UPDATE patients SET medical_notes = NULL WHERE id = ?').run(patientId);
      expect(setPhoto(png)).toMatchObject({ action: 'added' });
      expect(notesOf()).toEqual({ photoDataUrl: png });
    });
  });

  describe('audit trail', () => {
    it('records who changed which child\'s photo, with before and after, and the chain stays valid', () => {
      setPhoto(png);
      setPhoto(jpeg);

      const entries = db.prepare(`SELECT * FROM audit_log WHERE action_type = 'UPDATE' AND target_table = 'patients' ORDER BY id`).all();
      expect(entries).toHaveLength(2);
      expect(entries[1]).toMatchObject({ user_id: physicianId, target_id: patientId });
      expect(entries[1].details).toMatch(/^Photo replaced by physician \(old [0-9a-f]{12}, new [0-9a-f]{12}\)$/);
      // The previous photo can be recovered from the before-image.
      expect(JSON.parse(JSON.parse(entries[1].before_image).medical_notes).photoDataUrl).toBe(png);
      expect(JSON.parse(JSON.parse(entries[1].after_image).medical_notes).photoDataUrl).toBe(jpeg);
      expect(createAuditLogger(db).verifyChain().valid).toBe(true);
    });

    it('commits the change and its audit entry together, or neither', () => {
      db.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log WHEN NEW.action_type = 'UPDATE' BEGIN SELECT RAISE(ABORT, 'audit down'); END;`);
      expect(() => setPhoto(png)).toThrow(/audit down/);
      expect(notesOf().photoDataUrl).toBeNull();
    });
  });

  it('shows up when the patient is looked up, and is null once removed', () => {
    setPhoto(png);
    expect(findPatient(db, String(patientId)).patient.photoDataUrl).toBe(png);
    setPhoto(null);
    expect(findPatient(db, String(patientId)).patient.photoDataUrl).toBeNull();
  });
});
