// electron/database/auditLog.js
//
// Single source of truth for writing to audit_log. Every repository/service
// that touches patient data should log through here (in the same DB
// transaction as the data write) rather than INSERTing into audit_log by
// hand, so the hash chain never gets a row with a missing/incorrect
// prev_hash.
//
// Tamper evidence:
//   entry_hash = SHA-256(prev_hash + '|' + canonical(row fields))
// Each row's prev_hash is the entry_hash of the row immediately before it
// (NULL for the very first row). Re-deriving every hash from the stored
// field values and comparing against the stored entry_hash — and confirming
// each row's prev_hash equals the previous row's entry_hash — detects any
// edit, deletion, reordering, or splice, even one made by directly
// manipulating the database file (e.g. temporarily dropping the write-once
// triggers), because doing so cannot also recompute every hash from that
// point forward without the tampering being evident.

const crypto = require('crypto');

const ACTION_TYPES = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'LOGIN', 'LOGOUT'];

// Older/other parts of the UI (App.jsx, MedicationCheckIn.tsx, etc.) already
// call `audit:log-event` with a free-text `action` label like
// 'USER_LOGIN' or 'PATIENT_RECORD_VIEWED' rather than one of the six
// action_type values the schema's CHECK constraint allows. Rather than
// rewriting every call site, map the common labels to their closest
// action_type and keep the original label in `details` so nothing is lost.
const LEGACY_ACTION_MAP = {
    USER_LOGIN: 'LOGIN',
    LOGIN: 'LOGIN',
    USER_LOGOUT: 'LOGOUT',
    LOGOUT: 'LOGOUT',
    PATIENT_RECORD_VIEWED: 'READ',
    PATIENT_CREATED: 'CREATE',
    PATIENT_UPDATED: 'UPDATE',
    PATIENT_DELETED: 'DELETE',
    BACKUP_COMPLETED: 'EXPORT',
    BACKUP_FAILED: 'EXPORT',
    AUDIT_LOG_EXPORTED: 'EXPORT',
    CSV_IMPORTED: 'CREATE',
};

/**
 * Normalises whatever the caller passed as an action into a valid
 * action_type, preserving the original label in `details` if it had to be
 * re-mapped.
 */
function resolveActionType(actionType, action, details) {
    const candidate = (actionType || action || '').toString().toUpperCase();

    if (ACTION_TYPES.includes(candidate)) {
        return { resolvedActionType: candidate, resolvedDetails: details };
    }

    const mapped = LEGACY_ACTION_MAP[candidate];
    if (mapped) {
        const label = `original_action=${candidate}`;
        return {
            resolvedActionType: mapped,
            resolvedDetails: details ? `${details}; ${label}` : label,
        };
    }

    // Unrecognised label entirely: don't silently drop the event, but don't
    // guess wildly either. READ is the least destructive bucket.
    const label = `original_action=${candidate || 'UNKNOWN'}`;
    return {
        resolvedActionType: 'READ',
        resolvedDetails: details ? `${details}; ${label}` : label,
    };
}

/**
 * Canonical, order-stable string representation of the fields that make up
 * a row's identity, used as the hash input. JSON.stringify on an object with
 * a fixed key order is deterministic in V8, but we build the string by hand
 * anyway so the format can never silently drift if a field is reordered.
 */
function canonicalRow({ eventTime, userId, actionType, targetTable, targetId, beforeImage, afterImage, viewDurationMs, details }) {
    return [
        eventTime,
        userId ?? '',
        actionType,
        targetTable,
        targetId ?? '',
        beforeImage ?? '',
        afterImage ?? '',
        viewDurationMs ?? '',
        details ?? '',
    ].join('|');
}

function sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 */
function createAuditLogger(db) {
    const getLastHashStmt = db.prepare(`SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1`);

    const insertStmt = db.prepare(`
        INSERT INTO audit_log
            (event_time, user_id, action_type, target_table, target_id,
             before_image, after_image, view_duration_ms, details, prev_hash, entry_hash)
        VALUES
            (@eventTime, @userId, @actionType, @targetTable, @targetId,
             @beforeImage, @afterImage, @viewDurationMs, @details, @prevHash, @entryHash)
    `);

    /**
     * Appends one row to the audit log and returns it (including the hash
     * fields), so callers that need the id/hash back (e.g. to reference it
     * elsewhere) have it without a second query.
     *
     * Call this INSIDE the same db.transaction() as the data write it is
     * documenting, exactly like patientRepository.js does — that's what
     * guarantees the audit entry and the change it describes can never
     * drift apart (one commits, or neither does).
     */
    function logEvent({
        userId = null,
        action = null,
        actionType = null,
        targetTable,
        targetId = null,
        beforeImage = null,
        afterImage = null,
        viewDurationMs = null,
        details = null,
    }) {
        if (!targetTable) {
            throw new Error('auditLog.logEvent: targetTable is required');
        }

        const { resolvedActionType, resolvedDetails } = resolveActionType(actionType, action, details);
        const eventTime = new Date().toISOString();

        const beforeImageStr = beforeImage != null && typeof beforeImage !== 'string' ? JSON.stringify(beforeImage) : beforeImage;
        const afterImageStr = afterImage != null && typeof afterImage !== 'string' ? JSON.stringify(afterImage) : afterImage;

        const prevHash = getLastHashStmt.get()?.entry_hash ?? null;
        const rowForHash = {
            eventTime,
            userId,
            actionType: resolvedActionType,
            targetTable,
            targetId,
            beforeImage: beforeImageStr,
            afterImage: afterImageStr,
            viewDurationMs,
            details: resolvedDetails,
        };
        const entryHash = sha256Hex(`${prevHash ?? ''}|${canonicalRow(rowForHash)}`);

        const info = insertStmt.run({
            eventTime,
            userId,
            actionType: resolvedActionType,
            targetTable,
            targetId,
            beforeImage: beforeImageStr,
            afterImage: afterImageStr,
            viewDurationMs,
            details: resolvedDetails,
            prevHash,
            entryHash,
        });

        return { id: info.lastInsertRowid, ...rowForHash, prevHash, entryHash };
    }

    /**
     * Filtered read for the Audit Log Viewer. All filters are optional and
     * combine with AND.
     */
    function getEntries({ fromDate, toDate, userId, actionType, targetTable, targetId, limit = 500 } = {}) {
        const clauses = [];
        const params = {};

        if (fromDate) {
            clauses.push('a.event_time >= @fromDate');
            params.fromDate = fromDate;
        }
        if (toDate) {
            clauses.push('a.event_time <= @toDate');
            params.toDate = toDate;
        }
        if (userId) {
            clauses.push('a.user_id = @userId');
            params.userId = userId;
        }
        if (actionType) {
            clauses.push('a.action_type = @actionType');
            params.actionType = actionType;
        }
        if (targetTable) {
            clauses.push('a.target_table = @targetTable');
            params.targetTable = targetTable;
        }
        if (targetId) {
            clauses.push('a.target_id = @targetId');
            params.targetId = targetId;
        }

        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const cappedLimit = Math.min(Math.max(Number(limit) || 500, 1), 5000);

        const rows = db
            .prepare(
                `
            SELECT
                a.id, a.event_time, a.user_id, u.username AS username, u.full_name AS user_full_name,
                a.action_type, a.target_table, a.target_id,
                a.before_image, a.after_image, a.view_duration_ms, a.details,
                a.prev_hash, a.entry_hash
            FROM audit_log a
            LEFT JOIN users u ON u.id = a.user_id
            ${where}
            ORDER BY a.id DESC
            LIMIT @limit
        `
            )
            .all({ ...params, limit: cappedLimit });

        return rows;
    }

    /**
     * Walks the entire table in insertion order and recomputes every hash,
     * confirming: (a) each row's entry_hash matches its own field values,
     * and (b) each row's prev_hash matches the previous row's entry_hash.
     * Returns as soon as (or if) it finds the first broken link, since
     * everything after a tampered row is untrustworthy anyway.
     */
    function verifyChain() {
        const rows = db
            .prepare(
                `SELECT id, event_time, user_id, action_type, target_table, target_id,
                        before_image, after_image, view_duration_ms, details, prev_hash, entry_hash
                 FROM audit_log ORDER BY id ASC`
            )
            .all();

        let expectedPrevHash = null;

        for (const row of rows) {
            if ((row.prev_hash ?? null) !== (expectedPrevHash ?? null)) {
                return {
                    valid: false,
                    brokenAtId: row.id,
                    reason: `Row ${row.id}'s prev_hash does not match the entry_hash of the row before it — a row may have been inserted, deleted, or reordered.`,
                    checkedRows: rows.length,
                };
            }

            const recomputed = sha256Hex(
                `${row.prev_hash ?? ''}|${canonicalRow({
                    eventTime: row.event_time,
                    userId: row.user_id,
                    actionType: row.action_type,
                    targetTable: row.target_table,
                    targetId: row.target_id,
                    beforeImage: row.before_image,
                    afterImage: row.after_image,
                    viewDurationMs: row.view_duration_ms,
                    details: row.details,
                })}`
            );

            if (recomputed !== row.entry_hash) {
                return {
                    valid: false,
                    brokenAtId: row.id,
                    reason: `Row ${row.id}'s stored entry_hash does not match its content — this row was edited after being written.`,
                    checkedRows: rows.length,
                };
            }

            expectedPrevHash = row.entry_hash;
        }

        return { valid: true, checkedRows: rows.length };
    }

    return { logEvent, getEntries, verifyChain, ACTION_TYPES };
}

module.exports = { createAuditLogger, ACTION_TYPES, resolveActionType };
