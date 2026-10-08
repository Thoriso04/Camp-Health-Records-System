-- =====================================================================
-- Migration 004 — record where each import came from
--
-- sheet_sync_log started out as the log of Google Sheet syncs. Registration
-- CSV imports now share it, so each row says which kind it was. That keeps
-- "Last sync" on the dashboard about Google only, while every import (of
-- either kind) is still logged.
--
-- Existing rows are all Google syncs, which is what the default records.
-- =====================================================================

ALTER TABLE sheet_sync_log
    ADD COLUMN source TEXT NOT NULL DEFAULT 'google_sheet'
    CHECK (source IN ('google_sheet', 'csv_file'));
