const { createAuditLogger } = require('../database/auditLog');
const { resolveActiveUserId } = require('./userService');

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function importPatientsFromCsv(db, { rows, importedByUserId, campSessionDate } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('There are no valid patient rows to import.');
  }
  if (!isValidDate(campSessionDate)) {
    throw new Error('Choose a valid camp session date before importing.');
  }

  const createdBy = resolveActiveUserId(db, importedByUserId);
  const preparedRows = rows.map((row, index) => {
    const patient = {
      firstName: String(row.firstName ?? '').trim(),
      lastName: String(row.lastName ?? '').trim(),
      dateOfBirth: String(row.dateOfBirth ?? '').trim(),
      primaryDiagnosis: String(row.primaryDiagnosis ?? '').trim(),
    };

    if (!patient.firstName || !patient.lastName || !isValidDate(patient.dateOfBirth) || !patient.primaryDiagnosis) {
      throw new Error(`CSV row ${index + 2} is missing a required value or has an invalid date.`);
    }
    return patient;
  });

  const auditLog = createAuditLogger(db);
  const findDuplicate = db.prepare(`
    SELECT id FROM patients
    WHERE deleted_at IS NULL
      AND lower(trim(first_name)) = lower(@firstName)
      AND lower(trim(last_name)) = lower(@lastName)
      AND date_of_birth = @dateOfBirth
      AND camp_session_date = @campSessionDate
    LIMIT 1
  `);
  const insertPatient = db.prepare(`
    INSERT INTO patients
      (first_name, last_name, date_of_birth, primary_diagnosis,
       camp_session_date, created_by)
    VALUES
      (@firstName, @lastName, @dateOfBirth, @primaryDiagnosis,
       @campSessionDate, @createdBy)
  `);

  return db.transaction(() => {
    let imported = 0;
    let duplicates = 0;

    for (const patient of preparedRows) {
      const values = { ...patient, campSessionDate };
      if (findDuplicate.get(values)) {
        duplicates += 1;
        continue;
      }

      const info = insertPatient.run({ ...values, createdBy });
      auditLog.logEvent({
        userId: createdBy,
        actionType: 'CREATE',
        targetTable: 'patients',
        targetId: info.lastInsertRowid,
        afterImage: {
          first_name: patient.firstName,
          last_name: patient.lastName,
          date_of_birth: patient.dateOfBirth,
          primary_diagnosis: patient.primaryDiagnosis,
          camp_session_date: campSessionDate,
          created_by: createdBy,
          id: info.lastInsertRowid,
        },
      });
      imported += 1;
    }

    return { success: true, imported, duplicates };
  })();
}

module.exports = { importPatientsFromCsv };