// electron/services/patientUpdateService.js
//
// Edit an existing camper profile ("Edit record" on the dashboard).
//
// Rules:
//   - Physician and nurse only (the same people who hold EDIT_CLINICAL_RECORDS
//     in the UI). The role is checked here, in the main process, against the
//     role stored in the database, so it holds even if the button is shown by
//     mistake.
//   - Only the fields on the registration/medical pages can change. The signed
//     indemnity/consent record, the photo (its own physician-only flow) and the
//     import `source` marker are never touched; everything else already stored
//     in medical_notes is preserved exactly as it was.
//   - Nothing is written if nothing changed.
//   - The change and its audit entry (before and after image plus the names of
//     the fields that changed) are written in one transaction.

const { createAuditLogger } = require('../database/auditLog');
const { resolveActiveUserId } = require('./userService');

const EDIT_ROLES = ['camp_physician', 'camp_nurse'];

const TEXT_FIELDS = [
  'sex', 'tShirtSize', 'address', 'cellNumber', 'languageSpoken',
  'caregiverName', 'caregiverCell',
  'emergencyContactName', 'emergencyContactCell', 'emergencyContactRelationship',
  'clinicFileNumber', 'clinicContactDetails',
  'medicationHandedIn', 'viralLoadOver1000', 'tbHistory', 'hepatitisB', 'adherenceBarriers',
  'dietaryRequirements', 'religion', 'behavioralNotes', 'additionalDisclosures', 'linkedSiblingId',
];

const FLAG_GROUPS = {
  tbScreening: ['coughOver2Weeks', 'unexplainedWeightLoss', 'nightSweatsOrFevers'],
  dailyLivingAssistance: ['assistShowerBath', 'assistDressing', 'assistToileting', 'assistEating'],
};

const TEXT_GROUPS = {
  accessibility: ['eyesight', 'hearing', 'mobilityAids', 'prosthesis'],
};

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

// Accepts the database id ("12") or the id shown on screen ("CAMPER-012").
function parsePatientId(value) {
  const match = /^(?:CAMPER-)?(\d+)$/i.exec(String(value ?? '').trim());
  if (!match) throw new Error('Choose a patient first.');
  return Number(match[1]);
}

function requireEditor(db, suppliedUserId) {
  const userId = resolveActiveUserId(db, suppliedUserId);
  const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (!EDIT_ROLES.includes(actor?.role)) {
    throw new Error("Your role can't edit patient records.");
  }
  return userId;
}

// Rewriting notes we can't read could destroy clinical information, so refuse.
function readNotes(row) {
  let notes;
  try {
    notes = row.medical_notes ? JSON.parse(row.medical_notes) : {};
  } catch {
    notes = null;
  }
  if (notes === null || typeof notes !== 'object' || Array.isArray(notes)) {
    throw new Error("This patient's saved notes could not be read, so they were not changed.");
  }
  return notes;
}

const text = (value) => String(value ?? '').trim();
const textList = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

function splitAllergies(value) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function toProfile(row) {
  const notes = readNotes(row);
  const group = (name, keys, fallback) =>
    Object.fromEntries(keys.map((key) => [key, notes[name]?.[key] ?? fallback]));

  return {
    databaseId: String(row.id),
    id: `CAMPER-${String(row.id).padStart(3, '0')}`,
    firstName: row.first_name,
    surname: row.last_name,
    dateOfBirth: row.date_of_birth,
    campSessionDate: row.camp_session_date,
    diagnosis: row.primary_diagnosis,
    allergies: splitAllergies(row.known_allergies),
    currentMedication: textList(notes.currentMedication),
    ...Object.fromEntries(TEXT_FIELDS.map((key) => [key, text(notes[key])])),
    tbScreening: group('tbScreening', FLAG_GROUPS.tbScreening, false),
    dailyLivingAssistance: group('dailyLivingAssistance', FLAG_GROUPS.dailyLivingAssistance, false),
    accessibility: group('accessibility', TEXT_GROUPS.accessibility, ''),
  };
}

function loadRow(db, id) {
  const row = db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw new Error('That patient record could not be found.');
  return row;
}

/** Full editable profile for the edit form. */
function getPatientProfile(db, { patientId, userId } = {}) {
  requireEditor(db, userId);
  return { success: true, profile: toProfile(loadRow(db, parsePatientId(patientId))) };
}

/**
 * @param {object} options
 * @param {string|number} options.patientId
 * @param {string|number} options.userId   the signed-in user making the change
 * @param {object}        options.changes  the edited profile (same shape getPatientProfile returns)
 * @returns {{ success: true, changed: boolean, id: string, changedFields: string[] }}
 */
function updatePatientProfile(db, { patientId, userId, changes } = {}) {
  const actingUserId = requireEditor(db, userId);
  const id = parsePatientId(patientId);
  const input = changes && typeof changes === 'object' ? changes : {};

  const firstName = text(input.firstName);
  const lastName = text(input.surname ?? input.lastName);
  const dateOfBirth = text(input.dateOfBirth);
  const campSessionDate = text(input.campSessionDate);
  const diagnosis = text(input.diagnosis) || 'Not provided';

  if (!firstName || !lastName) throw new Error('First name and surname are required.');
  if (!isValidDate(dateOfBirth)) throw new Error('Enter a valid date of birth in YYYY-MM-DD format.');
  if (!isValidDate(campSessionDate)) throw new Error('Enter a valid camp session date in YYYY-MM-DD format.');
  if (!text(input.caregiverName)) throw new Error('Parent/caregiver name is required.');
  if (!text(input.emergencyContactName)) throw new Error('Emergency contact name is required.');

  const auditLog = createAuditLogger(db);

  return db.transaction(() => {
    const before = loadRow(db, id);
    const notes = readNotes(before);

    // Only touch the keys this form owns, and only when the value really differs
    // from what is stored. A key that is absent (e.g. on a record imported from
    // the sheet) and is saved back as empty counts as unchanged, so opening and
    // saving a record never rewrites it or creates a misleading audit entry.
    const nextNotes = { ...notes };
    const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const assign = (key, nextValue, storedValue) => {
      if (!sameValue(nextValue, storedValue)) nextNotes[key] = nextValue;
    };

    for (const key of TEXT_FIELDS) {
      if (key in input) assign(key, text(input[key]), text(notes[key]));
    }
    if ('currentMedication' in input) {
      assign('currentMedication', textList(input.currentMedication), textList(notes.currentMedication));
    }
    for (const [name, keys] of Object.entries(FLAG_GROUPS)) {
      if (input[name] && typeof input[name] === 'object') {
        const next = Object.fromEntries(keys.map((k) => [k, Boolean(input[name][k])]));
        const stored = Object.fromEntries(keys.map((k) => [k, Boolean(notes[name]?.[k])]));
        if (!sameValue(next, stored)) nextNotes[name] = { ...(notes[name] ?? {}), ...next };
      }
    }
    for (const [name, keys] of Object.entries(TEXT_GROUPS)) {
      if (input[name] && typeof input[name] === 'object') {
        const next = Object.fromEntries(keys.map((k) => [k, text(input[name][k])]));
        const stored = Object.fromEntries(keys.map((k) => [k, text(notes[name]?.[k])]));
        if (!sameValue(next, stored)) nextNotes[name] = { ...(notes[name] ?? {}), ...next };
      }
    }

    // Compare allergies as a list so a pure formatting difference ("a,b" vs "a, b")
    // is not treated as an edit; the stored text is kept when the list is unchanged.
    const nextAllergies = 'allergies' in input ? textList(input.allergies) : splitAllergies(before.known_allergies);
    const allergies = sameValue(nextAllergies, splitAllergies(before.known_allergies))
      ? before.known_allergies
      : nextAllergies.join(', ');
    const medicalNotes = JSON.stringify(nextNotes);

    const changedFields = [];
    if (firstName !== before.first_name) changedFields.push('firstName');
    if (lastName !== before.last_name) changedFields.push('surname');
    if (dateOfBirth !== before.date_of_birth) changedFields.push('dateOfBirth');
    if (campSessionDate !== before.camp_session_date) changedFields.push('campSessionDate');
    if (diagnosis !== before.primary_diagnosis) changedFields.push('diagnosis');
    if (allergies !== before.known_allergies) changedFields.push('allergies');
    for (const key of Object.keys(nextNotes)) {
      if (JSON.stringify(nextNotes[key]) !== JSON.stringify(notes[key])) changedFields.push(key);
    }

    if (changedFields.length === 0) {
      return { success: true, changed: false, id: String(id), changedFields };
    }

    db.prepare(`
      UPDATE patients
      SET first_name = @firstName,
          last_name = @lastName,
          date_of_birth = @dateOfBirth,
          primary_diagnosis = @diagnosis,
          known_allergies = @allergies,
          medical_notes = @medicalNotes,
          camp_session_date = @campSessionDate,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = @id AND deleted_at IS NULL
    `).run({ id, firstName, lastName, dateOfBirth, diagnosis, allergies, medicalNotes, campSessionDate });

    const after = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);

    auditLog.logEvent({
      userId: actingUserId,
      actionType: 'UPDATE',
      targetTable: 'patients',
      targetId: id,
      beforeImage: before,
      afterImage: after,
      details: `Profile edited. Fields changed: ${changedFields.join(', ')}`,
    });

    return { success: true, changed: true, id: String(id), changedFields };
  })();
}

module.exports = { EDIT_ROLES, getPatientProfile, updatePatientProfile };
