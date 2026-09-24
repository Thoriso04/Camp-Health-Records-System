import { useState } from 'react';
import { Download, ShieldCheck, ShieldAlert, Filter, X } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * FR-09: Audit Logging (viewer half)
 *
 * "The Physician may filter by date range, user, action type, and
 * target patient, and may export to PDF/CSV (the export itself is
 * logged)."
 *
 * Backed by electron/database/auditLog.js: entries are hash-chained
 * (prev_hash/entry_hash) and the underlying table is write-once (DB
 * triggers ABORT any UPDATE/DELETE), so "Verify integrity" below is a real
 * check, not decoration -- it re-derives every hash and reports the first
 * row where the chain breaks, if any.
 */

const ACTION_TYPES = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'LOGIN', 'LOGOUT'] as const;

interface AuditEntry {
  id: number;
  event_time: string;
  user_id: number | null;
  username?: string | null;
  user_full_name?: string | null;
  action_type: string;
  target_table: string;
  target_id?: number | null;
  before_image?: string | null;
  after_image?: string | null;
  view_duration_ms?: number | null;
  details?: string | null;
  prev_hash?: string | null;
  entry_hash: string;
}

interface Filters {
  fromDate: string;
  toDate: string;
  userId: string;
  actionType: string;
  targetId: string;
}

const EMPTY_FILTERS: Filters = { fromDate: '', toDate: '', userId: '', actionType: '', targetId: '' };

function toCsv(entries: AuditEntry[]): string {
  const headers = ['id', 'event_time', 'user_id', 'username', 'action_type', 'target_table', 'target_id', 'details', 'entry_hash'];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = entries.map((e) =>
    [e.id, e.event_time, e.user_id, e.username, e.action_type, e.target_table, e.target_id, e.details, e.entry_hash]
      .map(escape)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export default function AuditLogViewer() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [integrity, setIntegrity] = useState<{ valid: boolean; reason?: string; checkedRows?: number } | null>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);

  const loadEntries = async () => {
    setLoading(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {};
      if (filters.fromDate) payload.fromDate = filters.fromDate;
      if (filters.toDate) payload.toDate = filters.toDate;
      if (filters.userId) payload.userId = Number(filters.userId);
      if (filters.actionType) payload.actionType = filters.actionType;
      if (filters.targetId) payload.targetId = Number(filters.targetId);

      const result = await apiService.request<AuditEntry[]>('audit:get-entries', payload);
      setEntries(Array.isArray(result) ? result : []);
    } catch {
      setError("Couldn't load the audit log. Try again, or check the connection to the local database.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
  };

  const handleExport = async () => {
    if (!entries || entries.length === 0) return;
    const csv = toCsv(entries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chrs_audit_log_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    await apiService.request('audit:log-event', {
      userId: user?.userId,
      actionType: 'EXPORT',
      targetTable: 'audit_log',
      details: `Exported ${entries.length} audit log entries to CSV`,
    });
  };

  const handleVerifyIntegrity = async () => {
    setCheckingIntegrity(true);
    setIntegrity(null);
    try {
      const result = await apiService.request<{ valid: boolean; reason?: string; checkedRows?: number }>('audit:verify-chain', {});
      setIntegrity(result);
    } catch {
      setIntegrity({ valid: false, reason: "Couldn't run the integrity check." });
    } finally {
      setCheckingIntegrity(false);
    }
  };

  return (
    <div className="rounded border border-slate-100 bg-white shadow-card">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Audit log</h3>
          <p className="text-xs text-slate-500">Physician-only, per FR-09 &mdash; append-only, hash-chained</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            Filters
          </button>
          <button
            onClick={handleVerifyIntegrity}
            disabled={checkingIntegrity}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-clinical-600 hover:bg-clinical-50 disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {checkingIntegrity ? 'Checking…' : 'Verify integrity'}
          </button>
          {entries && entries.length > 0 && (
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-clinical-600 hover:bg-clinical-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </button>
          )}
          <button
            onClick={loadEntries}
            disabled={loading}
            className="rounded bg-clinical-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
          >
            {loading ? 'Loading…' : entries ? 'Refresh' : 'Load log'}
          </button>
        </div>
      </header>

      {showFilters && (
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <label className="text-xs">
              <span className="mb-1 block font-medium text-slate-600">From</span>
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-slate-600">To</span>
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-slate-600">User ID</span>
              <input
                type="number"
                value={filters.userId}
                onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
                placeholder="e.g. 3"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-slate-600">Action type</span>
              <select
                value={filters.actionType}
                onChange={(e) => setFilters((f) => ({ ...f, actionType: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="">Any</option>
                {ACTION_TYPES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-slate-600">Target patient ID</span>
              <input
                type="number"
                value={filters.targetId}
                onChange={(e) => setFilters((f) => ({ ...f, targetId: e.target.value }))}
                placeholder="e.g. 42"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={loadEntries}
              disabled={loading}
              className="rounded bg-clinical-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
            >
              Apply filters
            </button>
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          </div>
        </div>
      )}

      {integrity && (
        <div
          className={`flex items-center gap-2 border-b border-slate-100 px-5 py-2 text-xs font-medium ${
            integrity.valid ? 'bg-confirm-50 text-confirm-600' : 'bg-alert-50 text-alert-600'
          }`}
        >
          {integrity.valid ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}
          {integrity.valid
            ? `Chain intact — ${integrity.checkedRows ?? 0} entries verified, no tampering detected.`
            : `Integrity check failed: ${integrity.reason}`}
        </div>
      )}

      <div className="p-5">
        {error && <p className="mb-3 text-xs font-medium text-alert-600">{error}</p>}

        {!entries && !error && (
          <p className="text-sm text-slate-500">Load the audit log to view recent access and changes.</p>
        )}

        {entries && entries.length === 0 && !error && (
          <p className="text-sm text-slate-500">No audit entries match the current filters.</p>
        )}

        {entries && entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-medium text-slate-500">
                  <th className="pb-2 pr-4">Timestamp</th>
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2 pr-4">Action</th>
                  <th className="pb-2 pr-4">Target</th>
                  <th className="pb-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-500">{entry.event_time}</td>
                    <td className="py-2 pr-4">{entry.username ?? entry.user_id ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                        {entry.action_type}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-600">
                      {entry.target_table}
                      {entry.target_id != null ? ` #${entry.target_id}` : ''}
                    </td>
                    <td className="py-2 text-xs text-slate-500">{entry.details ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
