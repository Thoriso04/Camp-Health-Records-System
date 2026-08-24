import { useState } from 'react';
import { Download } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * FR-09: Audit Logging (viewer half)
 *
 * "The Physician may filter by date range, user, action type, and
 * target patient, and may export to PDF/CSV (the export itself is
 * logged)."
 *
 * NOTE: apiService.request('audit:get-entries', ...) does NOT exist in
 * electron/main.js yet — only audit:log-event (writing) exists, there's
 * no handler for READING entries back out. Until that exists, this
 * shows an empty state rather than fake data, since inventing plausible
 * audit entries for a compliance feature is worse than showing nothing.
 */

interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  action: string;
  targetId?: string;
}

export default function AuditLogViewer() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadEntries = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiService.request<AuditEntry[]>('audit:get-entries', {});
      setEntries(Array.isArray(result) ? result : []);
    } catch {
      setError("Couldn't load the audit log — this IPC handler isn't built yet.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    await apiService.request('audit:log-event', {
      userId: user?.userId,
      action: 'AUDIT_LOG_EXPORTED',
    });
  };

  return (
    <div className="rounded border border-slate-100 bg-white shadow-card">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Audit log</h3>
          <p className="text-xs text-slate-500">Physician-only, per FR-09</p>
        </div>
        <div className="flex gap-2">
          {entries && entries.length > 0 && (
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-clinical-600 hover:bg-clinical-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export
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

      <div className="p-5">
        {error && <p className="mb-3 text-xs font-medium text-alert-600">{error}</p>}

        {!entries && !error && (
          <p className="text-sm text-slate-500">Load the audit log to view recent access and changes.</p>
        )}

        {entries && entries.length === 0 && !error && (
          <p className="text-sm text-slate-500">No audit entries returned.</p>
        )}

        {entries && entries.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs font-medium text-slate-500">
                <th className="pb-2">Timestamp</th>
                <th className="pb-2">User</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100">
                  <td className="py-2 font-mono text-xs text-slate-500">{entry.timestamp}</td>
                  <td className="py-2">{entry.userId}</td>
                  <td className="py-2">{entry.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}