-- =====================================================================
-- CHRS Database Schema
-- Camp Health Records System — Just Footprints Foundation
-- Engine: SQLite + SQLCipher (AES-256, PBKDF2 key derivation)
-- =====================================================================

PRAGMA foreign_keys = ON;

-- USERS (FR-01) — application login accounts, RBAC

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,              -- bcrypt, cost factor 12
    role            TEXT NOT NULL CHECK (role IN ('camp_physician', 'camp_nurse', 'paramedic', 'camp_administrator')),
    full_name       TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT,                       -- ISO8601 timestamp, NULL if not locked
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- PATIENTS (FR-02) — camper medical records

CREATE TABLE IF NOT EXISTS patients (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    date_of_birth       TEXT NOT NULL,           -- YYYY-MM-DD
    primary_diagnosis   TEXT NOT NULL,
    known_allergies     TEXT NOT NULL DEFAULT '',-- free text; empty string = "none recorded"
    medical_notes       TEXT,
    camp_session_date   TEXT NOT NULL,           -- YYYY-MM-DD
    created_by          INTEGER NOT NULL REFERENCES users(id),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at          TEXT                     -- soft delete; audit log keeps the before-image
);

CREATE INDEX IF NOT EXISTS idx_patients_name_dob
    ON patients (last_name, first_name, date_of_birth);

-- Patient rows may only ever be soft-deleted (deleted_at set via an audited
-- UPDATE, per FR-09) so that a before/after image always survives in
-- audit_log. A hard DELETE would erase the row with no trail at all, so it
-- is blocked outright at the DB layer, independent of what the app layer does.
CREATE TRIGGER IF NOT EXISTS trg_patients_no_hard_delete
BEFORE DELETE ON patients
BEGIN
    SELECT RAISE(ABORT, 'patients rows cannot be hard-deleted; set deleted_at instead so the audit trail is preserved');
END;

-- MEDICATIONS (FR-03) — master list of medications available at camp
-- Header table + line-item table (one checkin can list several meds)

CREATE TABLE IF NOT EXISTS medication_checkins (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id          INTEGER NOT NULL REFERENCES patients(id),
    vital_signs         TEXT,                    -- JSON blob: {temp, hr, bp, resp, spo2}
    general_appearance  TEXT,
    new_symptoms        TEXT,
    clinician_signoff   TEXT NOT NULL,            -- typed name / signature capture, mandatory
    is_finalized        INTEGER NOT NULL DEFAULT 0, -- 0=draft in progress, 1=locked/view-only
    created_by          INTEGER NOT NULL REFERENCES users(id),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finalized_at        TEXT
);

CREATE TABLE IF NOT EXISTS medication_checkin_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    checkin_id          INTEGER NOT NULL REFERENCES medication_checkins(id),
    medication_name     TEXT NOT NULL,
    dosage              TEXT NOT NULL,
    route                TEXT NOT NULL,
    frequency            TEXT NOT NULL,
    last_dose_taken      TEXT,                    -- ISO8601 timestamp, nullable
    verified             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_med_checkins_patient
    ON medication_checkins (patient_id);

-- Once finalized, application layer must refuse UPDATE/DELETE (view-only record).
-- This trigger enforces that at the DB layer too.
CREATE TRIGGER IF NOT EXISTS trg_med_checkin_lock
BEFORE UPDATE ON medication_checkins
WHEN OLD.is_finalized = 1
BEGIN
    SELECT RAISE(ABORT, 'Finalized medication check-in is immutable');
END;

-- VISITS (FR-04) — clinical encounters, progress notes, treatment plans

CREATE TABLE IF NOT EXISTS medshack_visits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id      INTEGER NOT NULL REFERENCES patients(id),
    visit_datetime  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    clinician_name  TEXT NOT NULL,
    clinician_role  TEXT NOT NULL,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
    created_by      INTEGER NOT NULL REFERENCES users(id),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_visits_patient_date
    ON medshack_visits (patient_id, visit_datetime);

-- NEAR-MISS INCIDENTS (FR-05) — for reporting and tracking safety events
-- Restricted to Camp Physician + Camp Director at the application/RBAC layer.

CREATE TABLE IF NOT EXISTS near_miss_incidents (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_datetime     TEXT NOT NULL,
    location              TEXT NOT NULL,
    incident_type         TEXT NOT NULL CHECK (incident_type IN ('near_miss', 'medication_error', 'treatment_error', 'other')),
    staff_involved        TEXT NOT NULL,          -- free text list of names/roles
    description           TEXT NOT NULL,
    corrective_actions    TEXT NOT NULL,          -- mandatory, cannot save blank (enforce in app + CHECK)
    contributing_factors  TEXT,
    recommendations       TEXT,
    created_by            INTEGER NOT NULL REFERENCES users(id),
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (length(trim(corrective_actions)) > 0)
);

-- Junction table: a near-miss form can involve one or more patients
CREATE TABLE IF NOT EXISTS near_miss_patients (
    incident_id     INTEGER NOT NULL REFERENCES near_miss_incidents(id),
    patient_id      INTEGER NOT NULL REFERENCES patients(id),
    PRIMARY KEY (incident_id, patient_id)
);

-- AUDIT LOGS  (FR-09) — append-only, tamper-evident
--
-- Tamper-evidence is two layers deep:
--   1. Write-once at the DB layer: trg_audit_no_update / trg_audit_no_delete
--      below ABORT any UPDATE or DELETE against this table, full stop.
--   2. Hash-chained rows: every insert (see electron/database/auditLog.js)
--      carries prev_hash (the entry_hash of the row before it) and its own
--      entry_hash = SHA-256(prev_hash || canonical row fields). Re-walking
--      the chain (auditLog.verifyChain) recomputes every hash and confirms
--      each prev_hash matches the prior row's entry_hash, so even an actor
--      who bypasses layer 1 (e.g. temporarily dropping the triggers with
--      direct file/DB access) cannot edit, delete, or splice a row without
--      breaking the chain from that point forward.
CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    user_id         INTEGER REFERENCES users(id),
    action_type     TEXT NOT NULL CHECK (action_type IN (
                        'CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'LOGIN', 'LOGOUT'
                    )),
    target_table    TEXT NOT NULL,
    target_id       INTEGER,
    before_image    TEXT,                        -- JSON snapshot, NULL for CREATE
    after_image     TEXT,                         -- JSON snapshot, NULL for DELETE
    view_duration_ms INTEGER,                     -- populated for READ events
    details         TEXT,
    prev_hash       TEXT,                         -- entry_hash of the previous row; NULL only for row 1
    entry_hash      TEXT NOT NULL                 -- SHA-256(prev_hash || canonical fields of this row)
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log (event_time);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action_type);

-- Enforce immutability at the DB layer: block UPDATE and DELETE entirely.
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only: DELETE is not permitted');
END;

-- SECURITY LOG — failed login attempts (supports FR-01 lockout, FR-09)

CREATE TABLE IF NOT EXISTS security_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    username_attempted  TEXT NOT NULL,
    reason              TEXT NOT NULL
);

-- BACKUP LOG (supports FR-08)

CREATE TABLE IF NOT EXISTS backup_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    usb_drive_id    TEXT NOT NULL,
    folder_name     TEXT NOT NULL,
    sha256_hash     TEXT,
    status          TEXT NOT NULL CHECK (status IN ('success', 'failed'))
);

-- SCHEMA VERSION (for migration tracking)

CREATE TABLE IF NOT EXISTS schema_version (
    version         INTEGER PRIMARY KEY,
    applied_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO schema_version (version) VALUES (2);
-- v2: audit_log hash-chaining columns (prev_hash, entry_hash) + trg_patients_no_hard_delete.
-- No migration path is defined yet for upgrading a v1 database in place — this
-- schema is only ever applied fresh (see database.js#applySchema).