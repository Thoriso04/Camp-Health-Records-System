const Database = require('better-sqlite3-multiple-ciphers');
const { createAuditLogger } = require('../electron/database/auditLog');

describe('Audit log actor references', () => {
  let db;
  let auditLog;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);
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
    auditLog = createAuditLogger(db);
  });

  afterEach(() => {
    db.close();
  });

  it('keeps valid numeric user references linked', () => {
    const userId = db.prepare('INSERT INTO users (username) VALUES (?)').run('admin').lastInsertRowid;

    const entry = auditLog.logEvent({
      userId,
      actionType: 'LOGIN',
      targetTable: 'system',
    });

    expect(entry.userId).toBe(userId);
    expect(db.prepare('SELECT user_id FROM audit_log').get().user_id).toBe(userId);
    expect(auditLog.verifyChain().valid).toBe(true);
  });

  it('resolves legacy token IDs to an existing username', () => {
    const userId = db.prepare('INSERT INTO users (username) VALUES (?)').run('admin').lastInsertRowid;

    const entry = auditLog.logEvent({
      userId: 'usr-admin-01',
      actionType: 'LOGIN',
      targetTable: 'system',
    });

    expect(entry.userId).toBe(userId);
    expect(entry.details).toBeNull();
    expect(db.prepare('SELECT user_id FROM audit_log').get().user_id).toBe(userId);
    expect(auditLog.verifyChain().valid).toBe(true);
  });

  it('records unresolved legacy user IDs without violating the foreign key', () => {
    const entry = auditLog.logEvent({
      userId: 'usr-admin-01',
      actionType: 'LOGIN',
      targetTable: 'system',
    });
    const row = db.prepare('SELECT user_id, details FROM audit_log').get();

    expect(entry.userId).toBeNull();
    expect(row.user_id).toBeNull();
    expect(row.details).toBe('unresolved_user_id=usr-admin-01');
    expect(auditLog.verifyChain().valid).toBe(true);
  });
});