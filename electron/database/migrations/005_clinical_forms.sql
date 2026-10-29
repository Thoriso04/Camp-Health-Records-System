-- =====================================================================
-- Migration 005 — storage for the four clinical forms
--
-- FR-03 medication check-in : adds form_data (JSON of the whole paper form)
-- FR-04 MedShack visit      : adds reason / treatment_provided / disposition
-- FR-05 near-miss incident  : adds patients_involved, and makes filed
--                             reports immutable (no UPDATE, no DELETE)
-- FR-06 staff/crew check-in : new staff_checkins table, deliberately NOT
--                             linked to patients (stored separately)
-- =====================================================================

-- FR-03 ---------------------------------------------------------------
ALTER TABLE medication_checkins ADD COLUMN form_data TEXT;

-- FR-04 ---------------------------------------------------------------
ALTER TABLE medshack_visits ADD COLUMN reason TEXT;
ALTER TABLE medshack_visits ADD COLUMN treatment_provided TEXT;
ALTER TABLE medshack_visits ADD COLUMN disposition TEXT;

-- A finalised visit is a legal record: block edits and deletes at DB level.
CREATE TRIGGER IF NOT EXISTS trg_medshack_final_no_update
BEFORE UPDATE ON medshack_visits
WHEN OLD.status = 'final'
BEGIN
    SELECT RAISE(ABORT, 'Finalised MedShack visit record is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_medshack_no_delete
BEFORE DELETE ON medshack_visits
BEGIN
    SELECT RAISE(ABORT, 'MedShack visit records cannot be deleted');
END;

-- FR-05 ---------------------------------------------------------------
-- JSON array of the names typed on the form, kept even when a name does not
-- match a patient row (so nothing the reporter wrote is lost).
ALTER TABLE near_miss_incidents ADD COLUMN patients_involved TEXT;

CREATE TRIGGER IF NOT EXISTS trg_near_miss_no_update
BEFORE UPDATE ON near_miss_incidents
BEGIN
    SELECT RAISE(ABORT, 'Incident reports cannot be edited once filed');
END;

CREATE TRIGGER IF NOT EXISTS trg_near_miss_no_delete
BEFORE DELETE ON near_miss_incidents
BEGIN
    SELECT RAISE(ABORT, 'Incident reports cannot be deleted');
END;

-- FR-06 ---------------------------------------------------------------
-- Staff/crew are not campers: no patient_id, no join to patients.
-- retain_until = 12 months after the visit (pending legal confirmation, OI-04).
CREATE TABLE IF NOT EXISTS staff_checkins (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name           TEXT NOT NULL,
    role                TEXT,
    camp_site           TEXT NOT NULL,
    complaint           TEXT NOT NULL,
    temperature         TEXT,
    blood_pressure      TEXT,
    assessment_notes    TEXT,
    treatment_provided  TEXT,
    disposition         TEXT NOT NULL,
    recorded_by         INTEGER NOT NULL REFERENCES users(id),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    retain_until        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_checkins_created
    ON staff_checkins (created_at);
