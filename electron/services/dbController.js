const { openEncryptedDatabase } = require('./database');

let db = null;

function initDatabase(dbPath, key) {
  db = openEncryptedDatabase(dbPath, key);
  return db;
}

// --- PATIENTS ---
function getAllPatients() {
  return db.prepare('SELECT * FROM patients WHERE deleted_at IS NULL ORDER BY last_name ASC').all();
}

function insertPatient(patient) {
  const stmt = db.prepare(`
    INSERT INTO patients (first_name, last_name, date_of_birth, primary_diagnosis, known_allergies, medical_notes, camp_session_date, created_by)
    VALUES (@first_name, @last_name, @date_of_birth, @primary_diagnosis, @known_allergies, @medical_notes, @camp_session_date, @created_by)
  `);
  return stmt.run(patient);
}

// --- AUDIT LOGS ---
function logAuditEvent({ userId, actionType, targetTable, targetId, beforeImage, afterImage, details }) {
  const stmt = db.prepare(`
    INSERT INTO audit_log (user_id, action_type, target_table, target_id, before_image, after_image, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(userId, actionType, targetTable, targetId, beforeImage, afterImage, details);
}

module.exports = {
  initDatabase,
  getAllPatients,
  insertPatient,
  logAuditEvent
};