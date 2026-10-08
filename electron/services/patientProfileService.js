const { createAuditLogger } = require('../database/auditLog');
const { resolveActiveUserId } = require('./userService');

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function createPatientProfile(db, profile = {}) {
  const firstName = String(profile.firstName ?? '').trim();
  const lastName = String(profile.surname ?? profile.lastName ?? '').trim();
  const dateOfBirth = String(profile.dateOfBirth ?? '').trim();
  const campSessionDate = String(profile.campSessionDate ?? '').trim();
  const diagnosis = String(profile.diagnosis ?? '').trim() || 'Not provided';

  if (!firstName || !lastName) throw new Error('First name and surname are required.');
  if (!isValidDate(dateOfBirth)) throw new Error('Enter a valid date of birth in YYYY-MM-DD format.');
  if (!isValidDate(campSessionDate)) throw new Error('Enter a valid camp session date in YYYY-MM-DD format.');

  const createdBy = resolveActiveUserId(db, profile.createdByUserId);
  const allergies = Array.isArray(profile.allergies) ? profile.allergies.join(', ') : '';
  const medicalNotes = JSON.stringify({
    sex: profile.sex ?? '',
    tShirtSize: profile.tShirtSize ?? '',
    address: profile.address ?? '',
    cellNumber: profile.cellNumber ?? '',
    languageSpoken: profile.languageSpoken ?? '',
    photoDataUrl: profile.photoDataUrl ?? null,
    caregiverName: profile.caregiverName ?? '',
    caregiverCell: profile.caregiverCell ?? '',
    emergencyContactName: profile.emergencyContactName ?? '',
    emergencyContactCell: profile.emergencyContactCell ?? '',
    emergencyContactRelationship: profile.emergencyContactRelationship ?? '',
    clinicFileNumber: profile.clinicFileNumber ?? '',
    clinicContactDetails: profile.clinicContactDetails ?? '',
    currentMedication: profile.currentMedication ?? [],
    medicationHandedIn: profile.medicationHandedIn ?? '',
    viralLoadOver1000: profile.viralLoadOver1000 ?? '',
    tbHistory: profile.tbHistory ?? '',
    hepatitisB: profile.hepatitisB ?? '',
    adherenceBarriers: profile.adherenceBarriers ?? '',
    tbScreening: profile.tbScreening ?? {},
    accessibility: profile.accessibility ?? {},
    dailyLivingAssistance: profile.dailyLivingAssistance ?? {},
    dietaryRequirements: profile.dietaryRequirements ?? '',
    religion: profile.religion ?? '',
    behavioralNotes: profile.behavioralNotes ?? '',
    additionalDisclosures: profile.additionalDisclosures ?? '',
    linkedSiblingId: profile.linkedSiblingId ?? '',
    consent: profile.consent ?? {},
    // Only present for records that didn't come from the in-app form
    // (e.g. 'google_sheet'), so existing profiles keep their exact shape.
    ...(profile.source ? { source: String(profile.source) } : {}),
  });

  const insertPatient = db.prepare(`
    INSERT INTO patients
      (first_name, last_name, date_of_birth, primary_diagnosis, known_allergies,
       medical_notes, camp_session_date, created_by)
    VALUES
      (@firstName, @lastName, @dateOfBirth, @diagnosis, @allergies,
       @medicalNotes, @campSessionDate, @createdBy)
  `);
  const auditLog = createAuditLogger(db);
  const createTransaction = db.transaction(() => {
    const result = insertPatient.run({
      firstName,
      lastName,
      dateOfBirth,
      diagnosis,
      allergies,
      medicalNotes,
      campSessionDate,
      createdBy,
    });
    const id = result.lastInsertRowid;

    auditLog.logEvent({
      userId: createdBy,
      actionType: 'CREATE',
      targetTable: 'patients',
      targetId: id,
      details: profile.auditDetails ? String(profile.auditDetails) : null,
      afterImage: {
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dateOfBirth,
        primary_diagnosis: diagnosis,
        known_allergies: allergies,
        medical_notes: medicalNotes,
        camp_session_date: campSessionDate,
        created_by: createdBy,
        id,
      },
    });

    return id;
  });

  return { success: true, id: String(createTransaction()) };
}

module.exports = { createPatientProfile };