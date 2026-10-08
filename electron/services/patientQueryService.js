function mapPatient(row) {
  let profileDetails = {};
  try {
    profileDetails = JSON.parse(row.medical_notes || '{}');
  } catch {
    profileDetails = {};
  }

  const medicalNotes = [
    ...(Array.isArray(profileDetails.currentMedication) ? profileDetails.currentMedication.map((item) => `Medication: ${item}`) : []),
    profileDetails.tbHistory && `TB history: ${profileDetails.tbHistory}`,
    profileDetails.adherenceBarriers && `Adherence barriers: ${profileDetails.adherenceBarriers}`,
    profileDetails.dietaryRequirements && `Dietary requirements: ${profileDetails.dietaryRequirements}`,
    profileDetails.behavioralNotes,
    profileDetails.additionalDisclosures,
  ].filter(Boolean).join('; ');

  return {
    id: `CAMPER-${String(row.id).padStart(3, '0')}`,
    databaseId: String(row.id),
    name: `${row.first_name} ${row.last_name}`,
    dateOfBirth: row.date_of_birth,
    allergies: row.known_allergies
      ? row.known_allergies.split(',').map((allergy) => allergy.trim()).filter(Boolean)
      : [],
    diagnosis: row.primary_diagnosis,
    medicalNotes,
    // null when the child has no photo; the screen then shows a blank placeholder.
    photoDataUrl: typeof profileDetails.photoDataUrl === 'string' && profileDetails.photoDataUrl ? profileDetails.photoDataUrl : null,
  };
}

function findPatient(db, searchTerm) {
  const term = String(searchTerm ?? '').trim();
  if (!term) throw new Error('Enter a patient ID or full name to search.');

  const idMatch = /^(?:CAMPER-)?(\d+)$/i.exec(term);
  let rows;
  if (idMatch) {
    rows = db.prepare(`
      SELECT * FROM patients
      WHERE id = ? AND deleted_at IS NULL
    `).all(Number(idMatch[1]));
  } else {
    rows = db.prepare(`
      SELECT * FROM patients
      WHERE lower(trim(first_name || ' ' || last_name)) = lower(?)
        AND deleted_at IS NULL
      ORDER BY id ASC
      LIMIT 2
    `).all(term);
  }

  if (rows.length === 0) {
    throw new Error(`No patient found for "${term}". Search by patient ID or full name.`);
  }
  if (rows.length > 1) {
    throw new Error(`More than one patient matches "${term}". Search by patient ID instead.`);
  }

  return { success: true, patient: mapPatient(rows[0]) };
}

module.exports = { findPatient };