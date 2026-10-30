const Database = require('better-sqlite3-multiple-ciphers');
const { createPatientProfile } = require('../electron/services/patientProfileService');
const { findPatient } = require('../electron/services/patientQueryService');
const { getPatientProfile, updatePatientProfile } = require('../electron/services/patientUpdateService');
const { createAuditLogger } = require('../electron/database/auditLog');

describe('Patient update service (Edit record)', () => {
  let db;
  let physicianId;
  let nurseId;
  let counselorId;
  let adminId;
  let patientId;

  const baseProfile = () => ({
    firstName: 'Jane',
    surname: 'Smith',
    dateOfBirth: '2011-09-22',
    campSessionDate: '2026-10-01',
    diagnosis: 'Asthma',
    allergies: ['Peanuts', 'Latex'],
    caregiverName: 'Sam Smith',
    emergencyContactName: 'Ann Smith',
    currentMedication: ['Budesonide inhaler'],
    photoDataUrl: 'data:image/png;base64,AAAA',
    consent: { consentToDisclosure: true, guardianSignature: 'sig-data', witnessSignature: 'wit-data' },
    source: 'google_sheet',
    createdByUserId: 'usr-physician-01',
  });

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE patients (
        id INTEGER PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        primary_diagnosis TEXT NOT NULL,
        known_allergies TEXT NOT NULL DEFAULT '',
        medical_notes TEXT,
        camp_session_date TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        event_time TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id),
        action_type TEXT NOT NULL,
        target_table TEXT NOT NULL,
        target_id INTEGER,
        before_image TEXT,
        after_image TEXT,
        view_duration_ms INTEGER,
        details TEXT,
        prev_hash TEXT,
        entry_hash TEXT NOT NULL
      );
    `);
    const addUser = db.prepare('INSERT INTO users (username, role) VALUES (?, ?)');
    physicianId = Number(addUser.run('physician', 'camp_physician').lastInsertRowid);
    nurseId = Number(addUser.run('nurse', 'camp_nurse').lastInsertRowid);
    counselorId = Number(addUser.run('counselor', 'paramedic').lastInsertRowid);
    adminId = Number(addUser.run('admin', 'camp_administrator').lastInsertRowid);
    patientId = Number(createPatientProfile(db, baseProfile()).id);
  });

  afterEach(() => {
    db.close();
  });

  const auditRows = () => db.prepare("SELECT * FROM audit_log WHERE action_type = 'UPDATE' ORDER BY id").all();

  it('loads the full editable profile for a physician and a nurse', () => {
    const asPhysician = getPatientProfile(db, { patientId, userId: physicianId });
    expect(asPhysician.success).toBe(true);
    expect(asPhysician.profile).toMatchObject({
      id: 'CAMPER-001',
      firstName: 'Jane',
      surname: 'Smith',
      diagnosis: 'Asthma',
      allergies: ['Peanuts', 'Latex'],
      currentMedication: ['Budesonide inhaler'],
      caregiverName: 'Sam Smith',
    });
    // Signatures and the photo are never sent to the edit form.
    expect(JSON.stringify(asPhysician.profile)).not.toContain('sig-data');
    expect(JSON.stringify(asPhysician.profile)).not.toContain('AAAA');

    expect(getPatientProfile(db, { patientId: 'CAMPER-001', userId: nurseId }).success).toBe(true);
  });

  it('refuses to load or change a record for roles that cannot edit', () => {
    for (const userId of [counselorId, adminId]) {
      expect(() => getPatientProfile(db, { patientId, userId })).toThrow(/can't edit patient records/);
      const changes = { ...getPatientProfile(db, { patientId, userId: physicianId }).profile, diagnosis: 'Changed' };
      expect(() => updatePatientProfile(db, { patientId, userId, changes })).toThrow(/can't edit patient records/);
    }
    expect(db.prepare('SELECT primary_diagnosis FROM patients').get().primary_diagnosis).toBe('Asthma');
    expect(auditRows()).toHaveLength(0);
  });

  it('saves edits and writes one audit entry with before and after images', () => {
    const profile = getPatientProfile(db, { patientId, userId: nurseId }).profile;
    const result = updatePatientProfile(db, {
      patientId,
      userId: nurseId,
      changes: {
        ...profile,
        surname: 'Smith-Jones',
        diagnosis: 'Asthma and allergic rhinitis',
        allergies: ['Peanuts', 'Latex', 'Dust'],
        cellNumber: '0821234567',
        tbScreening: { ...profile.tbScreening, coughOver2Weeks: true },
        accessibility: { ...profile.accessibility, eyesight: 'Glasses' },
      },
    });

    expect(result).toMatchObject({ success: true, changed: true, id: String(patientId) });
    expect(result.changedFields).toEqual(
      expect.arrayContaining(['surname', 'diagnosis', 'allergies', 'cellNumber', 'tbScreening', 'accessibility']),
    );

    const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
    expect(row.last_name).toBe('Smith-Jones');
    expect(row.primary_diagnosis).toBe('Asthma and allergic rhinitis');
    expect(row.known_allergies).toBe('Peanuts, Latex, Dust');
    const notes = JSON.parse(row.medical_notes);
    expect(notes.cellNumber).toBe('0821234567');
    expect(notes.tbScreening.coughOver2Weeks).toBe(true);
    expect(notes.accessibility.eyesight).toBe('Glasses');

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(nurseId);
    expect(rows[0].target_table).toBe('patients');
    expect(Number(rows[0].target_id)).toBe(patientId);
    expect(JSON.parse(rows[0].before_image).last_name).toBe('Smith');
    expect(JSON.parse(rows[0].after_image).last_name).toBe('Smith-Jones');
    expect(rows[0].details).toMatch(/Fields changed: .*surname/);
  });

  it('keeps the signed consent, the photo and the import source exactly as they were', () => {
    const profile = getPatientProfile(db, { patientId, userId: physicianId }).profile;
    updatePatientProfile(db, {
      patientId,
      userId: physicianId,
      changes: {
        ...profile,
        religion: 'Christian',
        // A tampered request must not be able to rewrite the legal record or the photo.
        consent: { guardianSignature: 'forged' },
        photoDataUrl: 'data:image/png;base64,ZZZZ',
        source: 'something_else',
      },
    });

    const notes = JSON.parse(db.prepare('SELECT medical_notes FROM patients').get().medical_notes);
    expect(notes.religion).toBe('Christian');
    expect(notes.consent).toEqual(baseProfile().consent);
    expect(notes.photoDataUrl).toBe('data:image/png;base64,AAAA');
    expect(notes.source).toBe('google_sheet');
  });

  it('does nothing and writes no audit entry when nothing changed', () => {
    const profile = getPatientProfile(db, { patientId, userId: physicianId }).profile;
    const before = db.prepare('SELECT * FROM patients').get();

    const result = updatePatientProfile(db, { patientId, userId: physicianId, changes: profile });

    expect(result).toMatchObject({ success: true, changed: false, changedFields: [] });
    expect(db.prepare('SELECT * FROM patients').get()).toEqual(before);
    expect(auditRows()).toHaveLength(0);
  });

  it('does not treat missing optional keys or allergy formatting as edits', () => {
    // A record shaped like a sheet import: no tbScreening/accessibility keys, allergies without spaces.
    db.prepare('UPDATE patients SET known_allergies = ?, medical_notes = ? WHERE id = ?').run(
      'Eggs,Sofa drugs',
      JSON.stringify({ caregiverName: 'Sam Smith', emergencyContactName: 'Ann Smith', source: 'google_sheet' }),
      patientId,
    );
    const before = db.prepare('SELECT * FROM patients').get();

    const profile = getPatientProfile(db, { patientId, userId: physicianId }).profile;
    expect(profile.allergies).toEqual(['Eggs', 'Sofa drugs']);
    const result = updatePatientProfile(db, { patientId, userId: physicianId, changes: profile });

    expect(result.changed).toBe(false);
    expect(db.prepare('SELECT * FROM patients').get()).toEqual(before);
    expect(auditRows()).toHaveLength(0);
  });

  it('shows the new details through the normal patient search', () => {
    const profile = getPatientProfile(db, { patientId, userId: physicianId }).profile;
    updatePatientProfile(db, {
      patientId,
      userId: physicianId,
      changes: { ...profile, firstName: 'Janet', allergies: ['Shellfish'] },
    });

    const { patient } = findPatient(db, 'CAMPER-001');
    expect(patient.name).toBe('Janet Smith');
    expect(patient.allergies).toEqual(['Shellfish']);
    expect(findPatient(db, 'Janet Smith').success).toBe(true);
  });

  it('rejects invalid edits without changing anything', () => {
    const profile = getPatientProfile(db, { patientId, userId: physicianId }).profile;
    const attempt = (changes) => () => updatePatientProfile(db, { patientId, userId: physicianId, changes: { ...profile, ...changes } });

    expect(attempt({ firstName: '  ' })).toThrow(/First name and surname are required/);
    expect(attempt({ dateOfBirth: '22/09/2011' })).toThrow(/valid date of birth/);
    expect(attempt({ campSessionDate: '' })).toThrow(/valid camp session date/);
    expect(attempt({ caregiverName: '' })).toThrow(/caregiver name is required/);
    expect(attempt({ emergencyContactName: '' })).toThrow(/Emergency contact name is required/);
    expect(db.prepare('SELECT first_name FROM patients').get().first_name).toBe('Jane');
    expect(auditRows()).toHaveLength(0);
  });

  it('refuses to edit a missing or deleted patient, and a bad id', () => {
    const profile = getPatientProfile(db, { patientId, userId: physicianId }).profile;
    expect(() => updatePatientProfile(db, { patientId: 999, userId: physicianId, changes: profile })).toThrow(/could not be found/);
    expect(() => updatePatientProfile(db, { patientId: 'abc', userId: physicianId, changes: profile })).toThrow(/Choose a patient first/);

    db.prepare("UPDATE patients SET deleted_at = '2026-10-02T00:00:00Z' WHERE id = ?").run(patientId);
    expect(() => getPatientProfile(db, { patientId, userId: physicianId })).toThrow(/could not be found/);
  });

  it('refuses to rewrite notes it cannot read', () => {
    const profile = getPatientProfile(db, { patientId, userId: physicianId }).profile;
    db.prepare('UPDATE patients SET medical_notes = ? WHERE id = ?').run('{not json', patientId);

    expect(() => updatePatientProfile(db, { patientId, userId: physicianId, changes: { ...profile, religion: 'X' } })).toThrow(/could not be read/);
    expect(db.prepare('SELECT medical_notes FROM patients').get().medical_notes).toBe('{not json');
  });

  it('keeps the audit hash chain intact after an edit', () => {
    const profile = getPatientProfile(db, { patientId, userId: physicianId }).profile;
    updatePatientProfile(db, { patientId, userId: physicianId, changes: { ...profile, diagnosis: 'Updated' } });
    updatePatientProfile(db, { patientId, userId: physicianId, changes: { ...profile, diagnosis: 'Updated again' } });

    const verdict = createAuditLogger(db).verifyChain();
    expect(verdict.valid ?? verdict.ok ?? verdict.success).toBe(true);
    expect(auditRows()).toHaveLength(2);
  });
});
