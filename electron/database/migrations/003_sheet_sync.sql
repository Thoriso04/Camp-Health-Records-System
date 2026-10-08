-- =====================================================================
-- Migration 003 — Google Sheet registration sync
--
-- sheet_sync_rows : one row per Google Sheet response that has been
--                   processed. source_key is the primary key, so the same
--                   sheet row can never be imported twice, no matter how
--                   many times Sync is pressed.
-- sheet_sync_log  : one row per sync attempt (success or failure) so the
--                   dashboard can show "last synced" and failures can be
--                   investigated.
-- =====================================================================

CREATE TABLE IF NOT EXISTS sheet_sync_rows (
    source_key        TEXT PRIMARY KEY,           -- sha256 of sheet id + tab + response timestamp (+ occurrence index)
    patient_id        INTEGER NOT NULL REFERENCES patients(id),
    sheet_row_number  INTEGER,                    -- row number at the time of import (informational only)
    content_hash      TEXT NOT NULL,              -- sha256 of the row's cell values, to detect later edits in the sheet
    outcome           TEXT NOT NULL CHECK (outcome IN ('imported', 'matched_existing')),
    synced_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_rows_patient
    ON sheet_sync_rows (patient_id);

CREATE TABLE IF NOT EXISTS sheet_sync_log (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    triggered_by       INTEGER REFERENCES users(id),
    status             TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    rows_read          INTEGER NOT NULL DEFAULT 0,
    imported           INTEGER NOT NULL DEFAULT 0,
    already_synced     INTEGER NOT NULL DEFAULT 0,
    matched_existing   INTEGER NOT NULL DEFAULT 0,
    invalid_rows       INTEGER NOT NULL DEFAULT 0,
    changed_in_sheet   INTEGER NOT NULL DEFAULT 0,
    error_message      TEXT
);
