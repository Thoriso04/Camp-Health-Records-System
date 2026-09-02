const { openEncryptedDatabase } = require('../database/database');
const { createAuditLogger } = require('../database/auditLog');

let db = null;
let auditLog = null;

function initDatabase(dbPath, key) {
  db = openEncryptedDatabase(dbPath, key);
  auditLog = createAuditLogger(db);
  return db;
}

function getDb() {
  return db;
}

// --- PATIENTS ---
function getAllPatients() {
  return db.prepare('SELECT * FROM patients WHERE deleted_at IS NULL ORDER BY last_name ASC').all();
}

// Inserts the patient row and its CREATE audit entry in one transaction, so
// a patient can never exist without a matching audit trail (or vice versa).
function insertPatient(patient, userId) {
  const insertTxn = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO patients (first_name, last_name, date_of_birth, primary_diagnosis, known_allergies, medical_notes, camp_session_date, created_by)
      VALUES (@first_name, @last_name, @date_of_birth, @primary_diagnosis, @known_allergies, @medical_notes, @camp_session_date, @created_by)
    `);
    const info = stmt.run(patient);
    const newId = info.lastInsertRowid;

    auditLog.logEvent({
      userId: userId ?? patient.created_by,
      actionType: 'CREATE',
      targetTable: 'patients',
      targetId: newId,
      afterImage: { ...patient, id: newId },
    });

    return info;
  });

  return insertTxn();
}

// --- AUDIT LOGS ---

// Kept for backwards compatibility with any caller still using the old
// (userId, actionType, targetTable, targetId, beforeImage, afterImage,
// details) shape; delegates to the shared, hash-chained logger so every
// write — regardless of entry point — goes through the same chain.
function logAuditEvent({ userId, action, actionType, targetTable, targetId, beforeImage, afterImage, viewDurationMs, details }) {
  return auditLog.logEvent({ userId, action, actionType, targetTable, targetId, beforeImage, afterImage, viewDurationMs, details });
}

function getAuditEntries(filters) {
  return auditLog.getEntries(filters);
}

function verifyAuditChain() {
  return auditLog.verifyChain();
}

module.exports = {
  initDatabase,
  getDb,
  getAllPatients,
  insertPatient,
  logAuditEvent,
  getAuditEntries,
  verifyAuditChain,
};