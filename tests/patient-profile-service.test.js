const Database = require('better-sqlite3-multiple-ciphers');
const { createPatientProfile } = require('../electron/services/patientProfileService');
const { findPatient } = require('../electron/services/patientQueryService');
const { createAuditLogger } = require('../electron/database/auditLog');

describe('Patient profile service', () => {
  let db;
  let userId;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
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
    userId = db.prepare('INSERT INTO users (username) VALUES (?)').run('admin').lastInsertRowid;
  });

  afterEach(() => {
    db.close();
  });

  it('persists the profile and audit entry in one transaction', () => {
    const result = createPatientProfile(db, {
      firstName: 'Jane',
      surname: 'Smith',
      dateOfBirth: '2011-09-22',
      campSessionDate: '2026-10-01',
      diagnosis: 'Asthma',
      allergies: ['Peanuts', 'Latex'],
      caregiverName: 'Sam Smith',
      createdByUserId: 'usr-admin-01',
      consent: { consentToDisclosure: true },
    });
    const patient = db.prepare('SELECT * FROM patients').get();

    expect(result).toEqual({ success: true, id: '1' });
    expect(patient.created_by).toBe(userId);
    expect(patient.known_allergies).toBe('Peanuts, Latex');
    expect(JSON.parse(patient.medical_notes).caregiverName).toBe('Sam Smith');
    expect(JSON.parse(patient.medical_notes).consent.consentToDisclosure).toBe(true);
    expect(db.prepare('SELECT target_id FROM audit_log').get().target_id).toBe(1);
    expect(createAuditLogger(db).verifyChain().valid).toBe(true);
  });

  it('rejects invalid data or an unresolved user without inserting a patient', () => {
    expect(() => createPatientProfile(db, {
      firstName: 'Jane',
      surname: 'Smith',
      dateOfBirth: '2011-02-30',
      campSessionDate: '2026-10-01',
      createdByUserId: 'usr-admin-01',
    })).toThrow('Enter a valid date of birth');

    expect(() => createPatientProfile(db, {
      firstName: 'Jane',
      surname: 'Smith',
      dateOfBirth: '2011-09-22',
      campSessionDate: '2026-10-01',
      createdByUserId: 'usr-missing-01',
    })).toThrow('No active database user matches');

    expect(db.prepare('SELECT COUNT(*) AS count FROM patients').get().count).toBe(0);
  });

  it('finds a saved patient by database ID, display ID, or full name', () => {
    createPatientProfile(db, {
      firstName: 'Jane',
      surname: 'Smith',
      dateOfBirth: '2011-09-22',
      campSessionDate: '2026-10-01',
      diagnosis: 'Asthma',
      allergies: ['Peanuts'],
      createdByUserId: 'usr-admin-01',
    });

    const byNumericId = findPatient(db, '1');
    const byDisplayId = findPatient(db, 'CAMPER-001');
    const byName = findPatient(db, 'Jane Smith');

    expect(byNumericId.patient.name).toBe('Jane Smith');
    expect(byDisplayId.patient.id).toBe('CAMPER-001');
    expect(byName.patient.allergies).toEqual(['Peanuts']);
    expect(() => findPatient(db, 'CAMPER-999')).toThrow('No patient found');
  });
});