// electron/services/patientPhotoService.js
//
// Lets the camp physician add, replace or remove a child's photo after the
// child is in CHRS: for children imported without a photo, a wrong photo, or a
// better one taken at the medical tent.
//
// Rules:
//   - Physician only. This is checked here, in the main process, against the
//     role stored in the database, not just by hiding the button.
//   - Only the photo changes. Every other field in medical_notes is preserved
//     exactly as it was.
//   - Same image rules as imports (real JPEG/PNG/WebP bytes, 200 KB cap); the
//     renderer shrinks the picture to a thumbnail first.
//   - Every change is audited in the same transaction, with the before and
//     after record, so the previous photo can be recovered from the audit trail.
//   - No photo is a valid state: removing a photo stores null, never a
//     placeholder.

const crypto = require('crypto');
const { createAuditLogger } = require('../database/auditLog');
const { resolveActiveUserId } = require('./userService');
const { inspectImageDataUrl } = require('./registrationPhotos');

const PHYSICIAN_ROLE = 'camp_physician';

// Accepts the database id ("12") or the id shown on screen ("CAMPER-012").
function parsePatientId(value) {
  const match = /^(?:CAMPER-)?(\d+)$/i.exec(String(value ?? '').trim());
  if (!match) throw new Error('Choose a patient first.');
  return Number(match[1]);
}

const fingerprint = (dataUrl) => (dataUrl ? crypto.createHash('sha256').update(dataUrl).digest('hex').slice(0, 12) : null);

/**
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @param {object} options
 * @param {string|number} options.patientId
 * @param {string|null}   options.photoDataUrl  the new photo, or null/'' to remove it
 * @param {string|number} options.userId        the signed-in user making the change
 * @returns {{ success: true, changed: boolean, action: 'added'|'replaced'|'removed'|'unchanged', photoDataUrl: string|null }}
 */
function setPatientPhoto(db, { patientId, photoDataUrl, userId } = {}) {
  const actingUserId = resolveActiveUserId(db, userId);
  const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actingUserId);
  if (actor?.role !== PHYSICIAN_ROLE) {
    throw new Error("Only the camp physician can add or change a child's photo.");
  }

  const id = parsePatientId(patientId);

  let newPhoto = null;
  if (photoDataUrl !== null && photoDataUrl !== undefined && String(photoDataUrl).trim() !== '') {
    const checked = inspectImageDataUrl(photoDataUrl);
    if (!checked.dataUrl) throw new Error(`That photo ${checked.error}. Choose a JPG or PNG picture.`);
    newPhoto = checked.dataUrl;
  }

  const auditLog = createAuditLogger(db);

  return db.transaction(() => {
    const before = db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!before) throw new Error('That patient record could not be found.');

    let notes;
    try {
      notes = before.medical_notes ? JSON.parse(before.medical_notes) : {};
    } catch {
      // Rewriting a record we can't read could destroy clinical information.
      throw new Error("This patient's saved notes could not be read, so the photo was not changed.");
    }
    if (notes === null || typeof notes !== 'object' || Array.isArray(notes)) {
      throw new Error("This patient's saved notes could not be read, so the photo was not changed.");
    }

    const oldPhoto = typeof notes.photoDataUrl === 'string' && notes.photoDataUrl ? notes.photoDataUrl : null;
    if (oldPhoto === newPhoto) {
      return { success: true, changed: false, action: 'unchanged', photoDataUrl: newPhoto };
    }

    const action = newPhoto === null ? 'removed' : oldPhoto === null ? 'added' : 'replaced';
    notes.photoDataUrl = newPhoto;
    const medicalNotes = JSON.stringify(notes);

    db.prepare(`
      UPDATE patients
      SET medical_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND deleted_at IS NULL
    `).run(medicalNotes, id);
    const after = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);

    auditLog.logEvent({
      userId: actingUserId,
      actionType: 'UPDATE',
      targetTable: 'patients',
      targetId: id,
      beforeImage: before,
      afterImage: after,
      details: `Photo ${action} by physician (old ${fingerprint(oldPhoto) ?? 'none'}, new ${fingerprint(newPhoto) ?? 'none'})`,
    });

    return { success: true, changed: true, action, photoDataUrl: newPhoto };
  })();
}

module.exports = { PHYSICIAN_ROLE, setPatientPhoto };
