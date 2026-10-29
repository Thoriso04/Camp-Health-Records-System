// electron/services/clinicalRecordsService.js
//
// Read side of the four clinical forms (see clinicalFormsService.js for the
// write side):
//
//   listPatientRecords  medication check-ins + MedShack visits for one camper
//   listReports         filed incident reports, or staff/crew check-ins
//   getRecord           one record, laid out as labelled sections for display
//
// Access is re-checked here from the database role (not the UI). Opening a
// single record writes a READ entry to the audit log; the list views only
// return dates, names and status, never clinical content.

const { createAuditLogger } = require('../database/auditLog');
const { resolveActiveUserId } = require('./userService');

const CAMPER_VIEW_ROLES = ['camp_physician', 'camp_nurse', 'paramedic', 'camp_administrator'];
const INCIDENT_VIEW_ROLES = ['camp_physician', 'camp_nurse'];
const STAFF_VIEW_ROLES = ['camp_physician', 'camp_nurse'];

const KIND_ROLES = {
  medication: CAMPER_VIEW_ROLES,
  visit: CAMPER_VIEW_ROLES,
  incident: INCIDENT_VIEW_ROLES,
  staff: STAFF_VIEW_ROLES,
};

const INCIDENT_LABELS = {
  near_miss: 'Near-miss',
  medication_error: 'Medication error',
  treatment_error: 'Treatment error',
  other: 'Other patient safety incident',
};

function requireViewer(db, suppliedUserId, allowedRoles) {
  const userId = resolveActiveUserId(db, suppliedUserId);
  const { role } = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (!allowedRoles.includes(role)) {
    throw new Error('Your role is not permitted to view these records.');
  }
  return userId;
}

function patientNumber(patientId) {
  const match = /^(?:CAMPER-)?(\d+)$/i.exec(String(patientId ?? '').trim());
  if (!match) throw new Error('No patient selected.');
  return Number(match[1]);
}

const yesNo = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not answered');
const flag = (v) => (v ? 'Yes' : 'No');
const val = (v) => {
  const s = String(v ?? '').trim();
  return s || 'Not recorded';
};
const row = (label, value) => ({ label, value });

// --------------------------------------------------------------------
// Lists
// --------------------------------------------------------------------
function listPatientRecords(db, { patientId, userId } = {}) {
  requireViewer(db, userId, CAMPER_VIEW_ROLES);
  const id = patientNumber(patientId);

  const medicationCheckins = db
    .prepare(
      `SELECT id, created_at AS createdAt, clinician_signoff AS signedBy
         FROM medication_checkins
        WHERE patient_id = ?
        ORDER BY created_at DESC, id DESC`
    )
    .all(id);

  const visits = db
    .prepare(
      `SELECT id, visit_datetime AS visitDatetime, clinician_name AS clinicianName,
              clinician_role AS clinicianRole, status
         FROM medshack_visits
        WHERE patient_id = ?
        ORDER BY visit_datetime DESC, id DESC`
    )
    .all(id);

  return { success: true, medicationCheckins, visits };
}

function listReports(db, { kind, userId } = {}) {
  if (kind === 'incident') {
    requireViewer(db, userId, INCIDENT_VIEW_ROLES);
    const reports = db
      .prepare(
        `SELECT id, incident_datetime AS incidentDatetime, incident_type AS incidentType,
                location, created_at AS filedAt
           FROM near_miss_incidents
          ORDER BY incident_datetime DESC, id DESC`
      )
      .all()
      .map((r) => ({ ...r, incidentTypeLabel: INCIDENT_LABELS[r.incidentType] ?? r.incidentType }));
    return { success: true, reports };
  }

  if (kind === 'staff') {
    requireViewer(db, userId, STAFF_VIEW_ROLES);
    const reports = db
      .prepare(
        `SELECT id, full_name AS fullName, role, camp_site AS campSite,
                created_at AS createdAt, retain_until AS retainUntil
           FROM staff_checkins
          ORDER BY created_at DESC, id DESC`
      )
      .all();
    return { success: true, reports };
  }

  throw new Error('Unknown report type.');
}

// --------------------------------------------------------------------
// One record, ready to display
// --------------------------------------------------------------------
function buildMedication(db, id) {
  const c = db
    .prepare(
      `SELECT c.*, p.first_name, p.last_name, u.username
         FROM medication_checkins c
         JOIN patients p ON p.id = c.patient_id
         LEFT JOIN users u ON u.id = c.created_by
        WHERE c.id = ?`
    )
    .get(id);
  if (!c) return null;

  let f = {};
  try {
    f = JSON.parse(c.form_data || '{}');
  } catch {
    f = {};
  }
  const a = f.accessibility ?? {};
  const d = f.dailyLivingAssistance ?? {};
  const tb = f.tbScreening ?? {};
  const meds = Array.isArray(f.currentMedications) ? f.currentMedications : [];

  return {
    kind: 'medication',
    id: String(c.id),
    patientId: c.patient_id,
    title: 'Camper Medication Check-In and Assessment',
    subtitle: `${c.first_name} ${c.last_name}`,
    createdAt: c.created_at,
    status: 'Signed and locked',
    sections: [
      {
        heading: 'Accessibility',
        rows: [
          row('Eyesight', val(a.eyesight)),
          row('Hearing', val(a.hearing)),
          row('Mobility aids', val(a.mobilityAids)),
          row('Prosthesis', val(a.prosthesis)),
          row('Other', val(a.other)),
        ],
      },
      {
        heading: 'Assistance with daily living',
        rows: [
          row('Showering / bathing', flag(d.assistShowerBath)),
          row('Dressing', flag(d.assistDressing)),
          row('Toileting', flag(d.assistToileting)),
          row('Eating', flag(d.assistEating)),
        ],
      },
      {
        heading: 'TB screening',
        rows: [
          row('Cough for more than 2 weeks', flag(tb.coughOver2Weeks)),
          row('Unexplained weight loss', flag(tb.unexplainedWeightLoss)),
          row('Night sweats or fevers', flag(tb.nightSweatsOrFevers)),
        ],
      },
      {
        heading: 'Medication',
        rows: [
          row('Currently on medication', yesNo(f.onMedication)),
          row('Medication handed in', yesNo(f.medicationHandedIn)),
          row('Date handed in', val(f.medicationHandedInDate)),
          row('Current medications', meds.length ? meds.map((m, i) => `${i + 1}. ${m}`).join('\n') : 'None listed'),
        ],
      },
      {
        heading: 'General',
        rows: [
          row('Current physical condition', val(f.physicalCondition)),
          row('Dietary requirements', val(f.dietaryRequirements)),
          row('Additional information', val(f.additionalInfo)),
        ],
      },
      {
        heading: 'Sign-off',
        rows: [
          row('Medical person', val(c.clinician_signoff)),
          row('Signed at', val(f.signedAt || c.finalized_at)),
          row('Recorded by user', val(c.username)),
        ],
      },
    ],
    signature: typeof f.medicalPersonSignature === 'string' && f.medicalPersonSignature.startsWith('data:image/')
      ? f.medicalPersonSignature
      : null,
  };
}

function buildVisit(db, id) {
  const v = db
    .prepare(
      `SELECT v.*, p.first_name, p.last_name
         FROM medshack_visits v JOIN patients p ON p.id = v.patient_id
        WHERE v.id = ?`
    )
    .get(id);
  if (!v) return null;

  return {
    kind: 'visit',
    id: String(v.id),
    patientId: v.patient_id,
    title: 'MedShack Visit Record',
    subtitle: `${v.first_name} ${v.last_name}`,
    createdAt: v.visit_datetime,
    status: v.status === 'final' ? 'Finalised' : 'Draft',
    sections: [
      {
        heading: 'Visit',
        rows: [
          row('Date and time', val(v.visit_datetime)),
          row('Clinician', val(v.clinician_name)),
          row('Role', val(v.clinician_role)),
        ],
      },
      {
        heading: 'Clinical record',
        rows: [
          row('Reason for visit', val(v.reason ?? v.notes)),
          row('Treatment provided', val(v.treatment_provided)),
          row('Disposition', val(v.disposition)),
        ],
      },
    ],
    // Only drafts can be reopened for editing.
    draft:
      v.status === 'draft'
        ? {
            visitId: String(v.id),
            clinicianName: v.clinician_name,
            clinicianRole: v.clinician_role,
            reason: v.reason ?? v.notes ?? '',
            treatmentProvided: v.treatment_provided ?? '',
            disposition: v.disposition ?? '',
            initiatedAt: v.visit_datetime,
          }
        : null,
  };
}

function buildIncident(db, id) {
  const r = db
    .prepare(
      `SELECT i.*, u.username
         FROM near_miss_incidents i LEFT JOIN users u ON u.id = i.created_by
        WHERE i.id = ?`
    )
    .get(id);
  if (!r) return null;

  let names = [];
  try {
    names = JSON.parse(r.patients_involved || '[]');
  } catch {
    names = [];
  }
  const linked = db
    .prepare(
      `SELECT p.first_name, p.last_name FROM near_miss_patients np
         JOIN patients p ON p.id = np.patient_id WHERE np.incident_id = ?`
    )
    .all(id)
    .map((p) => `${p.first_name} ${p.last_name}`.toLowerCase());

  return {
    kind: 'incident',
    id: String(r.id),
    title: 'Near-Miss / Incident Report',
    subtitle: INCIDENT_LABELS[r.incident_type] ?? r.incident_type,
    createdAt: r.created_at,
    status: 'Filed — cannot be edited',
    sections: [
      {
        heading: 'Incident',
        rows: [
          row('Classification', INCIDENT_LABELS[r.incident_type] ?? r.incident_type),
          row('Date and time', val(r.incident_datetime)),
          row('Location', val(r.location)),
          row(
            'Patient(s) involved',
            names.length
              ? names.map((n) => (linked.includes(String(n).toLowerCase()) ? `${n} (linked to profile)` : n)).join('\n')
              : 'Not recorded'
          ),
          row('Staff involved', val(r.staff_involved)),
        ],
      },
      {
        heading: 'What happened',
        rows: [
          row('Description', val(r.description)),
          row('Corrective actions taken', val(r.corrective_actions)),
          row('Contributing factors', val(r.contributing_factors)),
          row('Recommendations', val(r.recommendations)),
        ],
      },
      { heading: 'Filing', rows: [row('Filed by user', val(r.username)), row('Filed at', val(r.created_at))] },
    ],
  };
}

function buildStaff(db, id) {
  const s = db
    .prepare(
      `SELECT s.*, u.username FROM staff_checkins s LEFT JOIN users u ON u.id = s.recorded_by WHERE s.id = ?`
    )
    .get(id);
  if (!s) return null;

  return {
    kind: 'staff',
    id: String(s.id),
    title: 'Medical Centre Check-In — Staff and Crew',
    subtitle: s.full_name,
    createdAt: s.created_at,
    status: `Kept until ${String(s.retain_until).slice(0, 10)}`,
    sections: [
      {
        heading: 'Person',
        rows: [row('Full name', val(s.full_name)), row('Role', val(s.role)), row('Camp site', val(s.camp_site))],
      },
      {
        heading: 'Visit',
        rows: [
          row('Reason for visit', val(s.complaint)),
          row('Temperature', val(s.temperature)),
          row('Blood pressure', val(s.blood_pressure)),
          row('Assessment notes', val(s.assessment_notes)),
          row('Treatment provided', val(s.treatment_provided)),
          row('Disposition', val(s.disposition)),
        ],
      },
      { heading: 'Recorded', rows: [row('Recorded by user', val(s.username)), row('Recorded at', val(s.created_at))] },
    ],
  };
}

const BUILDERS = {
  medication: { build: buildMedication, table: 'medication_checkins' },
  visit: { build: buildVisit, table: 'medshack_visits' },
  incident: { build: buildIncident, table: 'near_miss_incidents' },
  staff: { build: buildStaff, table: 'staff_checkins' },
};

function getRecord(db, { kind, id, userId } = {}) {
  const entry = BUILDERS[kind];
  if (!entry) throw new Error('Unknown record type.');
  const viewerId = requireViewer(db, userId, KIND_ROLES[kind]);

  const recordId = Number(id);
  if (!Number.isInteger(recordId)) throw new Error('No record selected.');

  const audit = createAuditLogger(db);
  const run = db.transaction(() => {
    const record = entry.build(db, recordId);
    if (!record) throw new Error('That record could not be found.');

    audit.logEvent({
      userId: viewerId,
      actionType: 'READ',
      targetTable: entry.table,
      targetId: recordId,
      details: 'Record opened for viewing',
    });
    return record;
  });

  return { success: true, record: run() };
}

module.exports = { listPatientRecords, listReports, getRecord };
