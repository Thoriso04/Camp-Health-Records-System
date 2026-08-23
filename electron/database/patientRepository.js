// electron/database/patientRepository.js
//
// Example repository showing the pattern every table module should follow:
// parameterised statements, a wrapping transaction, and an audit_log write
// in the SAME transaction as the data change (so they can never drift apart).

/**
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 */
function createPatientRepository(db) {
    const insertPatientStmt = db.prepare(`
        INSERT INTO patients
            (first_name, last_name, date_of_birth, primary_diagnosis,
             known_allergies, medical_notes, camp_session_date, created_by)
        VALUES (@firstName, @lastName, @dateOfBirth, @primaryDiagnosis,
                @knownAllergies, @medicalNotes, @campSessionDate, @createdBy)
    `);

    const insertAuditStmt = db.prepare(`
        INSERT INTO audit_log (user_id, action_type, target_table, target_id, after_image)
        VALUES (@userId, @actionType, @targetTable, @targetId, @afterImage)
    `);

    const getPatientStmt = db.prepare(`SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL`);

    /**
     * Creates a patient profile and writes the audit entry atomically.
     * Returns the new patient row and how long the DB transaction took (ms),
     * so callers can confirm the < 500ms acceptance criterion in real use.
     */
    function createPatient(patientData, userId) {
        const start = process.hrtime.bigint();

        const createTxn = db.transaction(() => {
            const info = insertPatientStmt.run(patientData);
            const newId = info.lastInsertRowid;

            insertAuditStmt.run({
                userId,
                actionType: 'CREATE',
                targetTable: 'patients',
                targetId: newId,
                afterImage: JSON.stringify({ ...patientData, id: newId }),
            });

            return newId;
        });

        const newId = createTxn();
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

        return { patient: getPatientStmt.get(newId), elapsedMs };
    }

    return { createPatient, getPatient: (id) => getPatientStmt.get(id) };
}

module.exports = { createPatientRepository };