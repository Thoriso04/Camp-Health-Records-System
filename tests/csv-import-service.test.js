const Database = require('better-sqlite3-multiple-ciphers');
const { importPatientsFromCsv } = require('../electron/services/csvImportService');
const { createAuditLogger } = require('../electron/database/auditLog');

describe('CSV patient import service', () => {
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

  it('imports patients, skips duplicates, and audits inserts atomically', () => {
    const result = importPatientsFromCsv(db, {
      importedByUserId: 'usr-admin-01',
      campSessionDate: '2026-10-01',
      rows: [
        { firstName: 'John', lastName: 'Doe', dateOfBirth: '2012-05-14', primaryDiagnosis: 'Asthma' },
        { firstName: 'John', lastName: 'Doe', dateOfBirth: '2012-05-14', primaryDiagnosis: 'Asthma' },
      ],
    });

    expect(result).toEqual({ success: true, imported: 1, duplicates: 1 });
    expect(db.prepare('SELECT created_by, camp_session_date FROM patients').get()).toEqual({
      created_by: userId,
      camp_session_date: '2026-10-01',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count).toBe(1);
    expect(createAuditLogger(db).verifyChain().valid).toBe(true);
  });

  it('does not insert patients when the signed-in account has no database user', () => {
    expect(() => importPatientsFromCsv(db, {
      importedByUserId: 'usr-missing-01',
      campSessionDate: '2026-10-01',
      rows: [{ firstName: 'Jane', lastName: 'Smith', dateOfBirth: '2011-09-22', primaryDiagnosis: 'None' }],
    })).toThrow('No active database user matches the signed-in account.');

    expect(db.prepare('SELECT COUNT(*) AS count FROM patients').get().count).toBe(0);
  });
});