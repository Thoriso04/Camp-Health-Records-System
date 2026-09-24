// electron/database/patientRepository.js
//
// Example repository showing the pattern every table module should follow:
// parameterised statements, a wrapping transaction, and an audit_log write
// (via the shared, hash-chained auditLog.logEvent) in the SAME transaction
// as the data change (so they can never drift apart).

const { createAuditLogger } = require('./auditLog');

/**
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 */
function createPatientRepository(db) {
    const auditLog = createAuditLogger(db);

    const insertPatientStmt = db.prepare(`
        INSERT INTO patients
            (first_name, last_name, date_of_birth, primary_diagnosis,
             known_allergies, medical_notes, camp_session_date, created_by)
        VALUES (@firstName, @lastName, @dateOfBirth, @primaryDiagnosis,
                @knownAllergies, @medicalNotes, @campSessionDate, @createdBy)
    `);

    const updatePatientStmt = db.prepare(`
        UPDATE patients SET
            first_name = @firstName, last_name = @lastName, date_of_birth = @dateOfBirth,
            primary_diagnosis = @primaryDiagnosis, known_allergies = @knownAllergies,
            medical_notes = @medicalNotes, camp_session_date = @campSessionDate,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = @id AND deleted_at IS NULL
    `);

    const softDeletePatientStmt = db.prepare(`
        UPDATE patients SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = @id AND deleted_at IS NULL
    `);

    const getPatientStmt = db.prepare(`SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL`);
    const getPatientAnyStmt = db.prepare(`SELECT * FROM patients WHERE id = ?`);

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

            auditLog.logEvent({
                userId,
                actionType: 'CREATE',
                targetTable: 'patients',
                targetId: newId,
                afterImage: { ...patientData, id: newId },
            });

            return newId;
        });

        const newId = createTxn();
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

        return { patient: getPatientStmt.get(newId), elapsedMs };
    }

    /**
     * Updates a patient profile, logging both the before- and after-image
     * in the same transaction as the write.
     */
    function updatePatient(id, patientData, userId) {
        const updateTxn = db.transaction(() => {
            const before = getPatientStmt.get(id);
            if (!before) {
                throw new Error(`updatePatient: no active patient with id ${id}`);
            }

            updatePatientStmt.run({ ...patientData, id });
            const after = getPatientStmt.get(id);

            auditLog.logEvent({
                userId,
                actionType: 'UPDATE',
                targetTable: 'patients',
                targetId: id,
                beforeImage: before,
                afterImage: after,
            });

            return after;
        });

        return updateTxn();
    }

    /**
     * Soft-deletes a patient (the DB layer blocks hard deletes outright —
     * see trg_patients_no_hard_delete in schema.sql) and logs the
     * before-image so the record is fully recoverable from the audit trail.
     */
    function deletePatient(id, userId) {
        const deleteTxn = db.transaction(() => {
            const before = getPatientStmt.get(id);
            if (!before) {
                throw new Error(`deletePatient: no active patient with id ${id}`);
            }

            softDeletePatientStmt.run({ id });
            const after = getPatientAnyStmt.get(id);

            auditLog.logEvent({
                userId,
                actionType: 'DELETE',
                targetTable: 'patients',
                targetId: id,
                beforeImage: before,
                afterImage: after,
            });

            return after;
        });

        return deleteTxn();
    }

    /**
     * Reads a patient and logs a READ event with how long the record was
     * open on screen, per FR-09's view_duration_ms field. Callers pass the
     * duration once the viewer closes; omit it to log the read immediately
     * with no duration.
     */
    function readPatient(id, userId, viewDurationMs = null) {
        const patient = getPatientStmt.get(id);
        if (patient) {
            auditLog.logEvent({
                userId,
                actionType: 'READ',
                targetTable: 'patients',
                targetId: id,
                viewDurationMs,
            });
        }
        return patient;
    }

    return {
        createPatient,
        updatePatient,
        deletePatient,
        readPatient,
        getPatient: (id) => getPatientStmt.get(id),
    };
}

module.exports = { createPatientRepository };