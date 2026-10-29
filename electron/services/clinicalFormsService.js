// electron/services/clinicalFormsService.js
//
// Backend for the four clinical forms:
//   FR-03 medication check-in      -> saveMedicationCheckin
//   FR-04 MedShack visit           -> saveMedShackVisit
//   FR-05 near-miss / incident     -> saveIncidentReport
//   FR-06 staff & crew check-in    -> saveStaffCheckin
//
// Every function writes the record AND its audit_log entry inside one
// transaction, so the two can never drift apart. Validation problems throw
// an Error with a readable message; handleIpcSafely turns that into
// { success: false, error } and the form shows it.

const { createAuditLogger } = require('../database/auditLog');
const { resolveActiveUserId } = require('./userService');

const INCIDENT_TYPES = {
  'near-miss': 'near_miss',
  'medication-error': 'medication_error',
  'treatment-error': 'treatment_error',
  other: 'other',
};

// Same people the UI lets file reports (rbac.ts: FILE_INCIDENT_REPORT).
// Re-checked here because a hidden button is not access control.
const INCIDENT_ROLES = ['camp_physician', 'camp_nurse'];

const text = (v) => String(v ?? '').trim();

function requirePatient(db, patientId) {
  // The UI shows ids like "CAMPER-003"; the database key is the number part.
  const match = /^(?:CAMPER-)?(\d+)$/i.exec(String(patientId ?? '').trim());
  if (!match) throw new Error('No patient selected.');
  const id = Number(match[1]);
  const row = db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw new Error('That patient record could not be found.');
  return row.id;
}

// --------------------------------------------------------------------
// FR-03 Medication check-in
// --------------------------------------------------------------------
function saveMedicationCheckin(db, payload = {}) {
  const patientId = requirePatient(db, payload.patientId);
  const userId = resolveActiveUserId(db, payload.userId);
  const signoff = text(payload.medicalPersonName);
  if (!signoff) throw new Error('The medical person’s name is required to sign off.');

  const now = new Date().toISOString();
  const medications = (Array.isArray(payload.currentMedications) ? payload.currentMedications : [])
    .map(text)
    .filter(Boolean);

  const formData = JSON.stringify({
    accessibility: payload.accessibility ?? {},
    dailyLivingAssistance: payload.dailyLivingAssistance ?? {},
    tbScreening: payload.tbScreening ?? {},
    onMedication: payload.onMedication ?? '',
    medicationHandedIn: payload.medicationHandedIn ?? '',
    medicationHandedInDate: payload.medicationHandedInDate ?? '',
    currentMedications: medications,
    physicalCondition: payload.physicalCondition ?? '',
    dietaryRequirements: payload.dietaryRequirements ?? '',
    additionalInfo: payload.additionalInfo ?? '',
    medicalPersonName: signoff,
    medicalPersonSignature: payload.medicalPersonSignature ?? '',
    signedAt: payload.signedAt ?? now,
  });

  const audit = createAuditLogger(db);
  const run = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO medication_checkins
           (patient_id, clinician_signoff, is_finalized, created_by, finalized_at, form_data)
         VALUES (?, ?, 1, ?, ?, ?)`
      )
      .run(patientId, signoff, userId, now, formData);
    const id = Number(result.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO medication_checkin_items
         (checkin_id, medication_name, dosage, route, frequency)
       VALUES (?, ?, 'Not recorded', 'Not recorded', 'Not recorded')`
    );
    medications.forEach((name) => insertItem.run(id, name));

    audit.logEvent({
      userId,
      actionType: 'CREATE',
      targetTable: 'medication_checkins',
      targetId: id,
      details: `Medication check-in saved for patient ${patientId}; ${medications.length} medication(s) listed`,
    });
    return id;
  });

  return { success: true, id: String(run()) };
}

// --------------------------------------------------------------------
// FR-04 MedShack visit  (draft can be re-saved; final is locked)
// --------------------------------------------------------------------
function saveMedShackVisit(db, payload = {}) {
  const patientId = requirePatient(db, payload.patientId);
  const userId = resolveActiveUserId(db, payload.userId);
  const status = payload.status === 'final' ? 'final' : 'draft';
  const clinicianName = text(payload.clinicianName);
  const clinicianRole = text(payload.clinicianRole) || 'Not stated';
  const reason = text(payload.reason);
  const disposition = text(payload.disposition);

  if (!clinicianName) throw new Error('Clinician name is required.');
  if (status === 'final') {
    if (!reason) throw new Error('Reason for visit is required to finalise.');
    if (!disposition) throw new Error('Disposition is required to finalise.');
  }

  const fields = {
    clinicianName,
    clinicianRole,
    reason,
    treatment: text(payload.treatmentProvided),
    disposition,
    status,
    visitTime: payload.initiatedAt || new Date().toISOString(),
    notes: reason, // keeps the generic notes column useful for the profile timeline
  };

  const audit = createAuditLogger(db);
  const run = db.transaction(() => {
    let id = payload.visitId == null ? null : Number(payload.visitId);

    if (id != null) {
      const existing = db
        .prepare('SELECT id, patient_id, status FROM medshack_visits WHERE id = ?')
        .get(id);
      if (!existing || existing.patient_id !== patientId) throw new Error('That visit record could not be found.');
      if (existing.status === 'final') throw new Error('This visit record is finalised and cannot be edited.');

      db.prepare(
        `UPDATE medshack_visits
            SET clinician_name = @clinicianName, clinician_role = @clinicianRole,
                reason = @reason, treatment_provided = @treatment, disposition = @disposition,
                notes = @notes, status = @status,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = @id`
      ).run({
        id,
        clinicianName: fields.clinicianName,
        clinicianRole: fields.clinicianRole,
        reason: fields.reason,
        treatment: fields.treatment,
        disposition: fields.disposition,
        notes: fields.notes,
        status: fields.status,
      });
    } else {
      id = Number(
        db
          .prepare(
            `INSERT INTO medshack_visits
               (patient_id, visit_datetime, clinician_name, clinician_role,
                reason, treatment_provided, disposition, notes, status, created_by)
             VALUES (@patientId, @visitTime, @clinicianName, @clinicianRole,
                     @reason, @treatment, @disposition, @notes, @status, @userId)`
          )
          .run({
            patientId,
            userId,
            visitTime: fields.visitTime,
            clinicianName: fields.clinicianName,
            clinicianRole: fields.clinicianRole,
            reason: fields.reason,
            treatment: fields.treatment,
            disposition: fields.disposition,
            notes: fields.notes,
            status: fields.status,
          }).lastInsertRowid
      );
    }

    audit.logEvent({
      userId,
      actionType: payload.visitId == null ? 'CREATE' : 'UPDATE',
      targetTable: 'medshack_visits',
      targetId: id,
      details: status === 'final' ? 'MedShack visit finalised' : 'MedShack visit draft saved',
    });
    return id;
  });

  return { success: true, id: String(run()), status };
}

// --------------------------------------------------------------------
// FR-05 Near-miss / incident report  (insert-only)
// --------------------------------------------------------------------
function saveIncidentReport(db, payload = {}) {
  const userId = resolveActiveUserId(db, payload.reportedByUserId);
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (!INCIDENT_ROLES.includes(user.role)) {
    throw new Error('Your role is not permitted to file incident reports.');
  }

  const incidentType = INCIDENT_TYPES[payload.classification];
  if (!incidentType) throw new Error('Select an incident classification.');

  const when = new Date(payload.dateTime);
  if (Number.isNaN(when.valueOf())) throw new Error('Enter a valid date and time for the incident.');

  const location = text(payload.location);
  const description = text(payload.description);
  const corrective = text(payload.correctiveActions);
  const staff = (Array.isArray(payload.staffInvolved) ? payload.staffInvolved : []).map(text).filter(Boolean);
  const patients = (Array.isArray(payload.patientsInvolved) ? payload.patientsInvolved : []).map(text).filter(Boolean);

  if (!location) throw new Error('Location is required.');
  if (!description) throw new Error('A description of what happened is required.');
  if (!corrective) throw new Error('Corrective actions are required — a report cannot be filed without them.');
  if (staff.length === 0) throw new Error('Add at least one staff member involved.');
  if (patients.length === 0) throw new Error('Add at least one patient involved.');

  const findByName = db.prepare(
    `SELECT id FROM patients
      WHERE deleted_at IS NULL
        AND lower(first_name || ' ' || last_name) = lower(?)`
  );
  const linkPatient = db.prepare('INSERT OR IGNORE INTO near_miss_patients (incident_id, patient_id) VALUES (?, ?)');
  const audit = createAuditLogger(db);

  const run = db.transaction(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO near_miss_incidents
             (incident_datetime, location, incident_type, staff_involved, description,
              corrective_actions, contributing_factors, recommendations, patients_involved, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          when.toISOString(),
          location,
          incidentType,
          staff.join(', '),
          description,
          corrective,
          text(payload.contributingFactors) || null,
          text(payload.recommendations) || null,
          JSON.stringify(patients),
          userId
        ).lastInsertRowid
    );

    let linked = 0;
    for (const name of patients) {
      const matches = findByName.all(name);
      if (matches.length === 1) {
        linkPatient.run(id, matches[0].id);
        linked += 1;
      }
    }

    audit.logEvent({
      userId,
      actionType: 'CREATE',
      targetTable: 'near_miss_incidents',
      targetId: id,
      details: `Incident report filed (${incidentType}); ${linked} of ${patients.length} patient(s) linked to a profile`,
    });
    return id;
  });

  return { success: true, id: String(run()) };
}

// --------------------------------------------------------------------
// FR-06 Staff & crew check-in  (separate table, no patient link)
// --------------------------------------------------------------------
function saveStaffCheckin(db, payload = {}) {
  const userId = resolveActiveUserId(db, payload.recordedByUserId);
  const fullName = text(payload.fullName);
  const campSite = text(payload.campSite);
  const complaint = text(payload.complaint);
  const disposition = text(payload.disposition);

  if (!fullName) throw new Error('Full name is required.');
  if (!campSite) throw new Error('Camp site is required.');
  if (!complaint) throw new Error('Reason for visit is required.');
  if (!disposition) throw new Error('Disposition is required.');

  const retainUntil = new Date();
  retainUntil.setFullYear(retainUntil.getFullYear() + 1); // 12 months (OI-04)

  const audit = createAuditLogger(db);
  const run = db.transaction(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO staff_checkins
             (full_name, role, camp_site, complaint, temperature, blood_pressure,
              assessment_notes, treatment_provided, disposition, recorded_by, retain_until)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          fullName,
          text(payload.role) || null,
          campSite,
          complaint,
          text(payload.vitals?.temperature) || null,
          text(payload.vitals?.bloodPressure) || null,
          text(payload.assessmentNotes) || null,
          text(payload.treatmentProvided) || null,
          disposition,
          userId,
          retainUntil.toISOString()
        ).lastInsertRowid
    );

    // Audit row records that a visit happened, not the staff member's clinical
    // details, so staff data does not leak into the shared audit trail.
    audit.logEvent({
      userId,
      actionType: 'CREATE',
      targetTable: 'staff_checkins',
      targetId: id,
      details: 'Staff/crew check-in saved',
    });
    return id;
  });

  return { success: true, id: String(run()) };
}

module.exports = { saveMedicationCheckin, saveMedShackVisit, saveIncidentReport, saveStaffCheckin };
