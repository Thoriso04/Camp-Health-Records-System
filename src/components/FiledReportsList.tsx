import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Users } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { RecordKind } from './RecordViewer';

/**
 * Lists for records that are not tied to one camper's profile:
 *  - 'incident': filed near-miss / incident reports (restricted roles)
 *  - 'staff':    staff and crew check-ins (stored separately from campers)
 */

interface IncidentSummary {
  id: number;
  incidentDatetime: string;
  incidentTypeLabel: string;
  location: string;
}

interface StaffSummary {
  id: number;
  fullName: string;
  role: string | null;
  campSite: string;
  createdAt: string;
}

interface FiledReportsListProps {
  kind: 'incident' | 'staff';
  onOpen: (kind: RecordKind, id: string) => void;
  onClose: () => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? iso : d.toLocaleString();
};

export default function FiledReportsList({ kind, onOpen, onClose }: FiledReportsListProps) {
  const { user } = useAuth();
  const [reports, setReports] = useState<(IncidentSummary & StaffSummary)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiService
      .requestOrThrow<{ reports: (IncidentSummary & StaffSummary)[] }>('records:list-reports', {
        kind,
        userId: user?.userId,
      })
      .then((result) => {
        if (!cancelled) setReports(result.reports ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load the list.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, user?.userId]);

  const isIncident = kind === 'incident';
  const Icon = isIncident ? AlertTriangle : Users;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button onClick={onClose} className="text-sm font-semibold text-clinical-600 hover:underline">
        &larr; Back to dashboard
      </button>

      <div className="rounded border border-slate-100 bg-white shadow-card">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">
            {isIncident ? 'Filed incident reports' : 'Staff and crew check-ins'}
          </h2>
          <p className="text-xs text-slate-500">
            {isIncident
              ? 'Read-only. Reports cannot be edited or deleted once filed.'
              : 'Stored separately from camper records. Kept for 12 months.'}
          </p>
        </div>

        {loading && <p className="px-5 py-4 text-sm text-slate-500">Loading…</p>}
        {error && <p className="px-5 py-4 text-sm font-medium text-alert-600">{error}</p>}
        {!loading && !error && reports.length === 0 && (
          <p className="px-5 py-4 text-sm text-slate-500">Nothing has been filed yet.</p>
        )}

        <ul className="divide-y divide-slate-100">
          {reports.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onOpen(kind, String(r.id))}
                className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-clinical-50 focus-visible:bg-clinical-50"
              >
                <Icon className={`h-4 w-4 ${isIncident ? 'text-amber-600' : 'text-clinical-500'}`} aria-hidden="true" />
                <span className="flex-1">
                  {isIncident ? (
                    <>
                      <span className="block text-sm font-medium text-ink">{r.incidentTypeLabel}</span>
                      <span className="block text-xs text-slate-500">
                        {when(r.incidentDatetime)} &middot; {r.location}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block text-sm font-medium text-ink">{r.fullName}</span>
                      <span className="block text-xs text-slate-500">
                        {when(r.createdAt)} &middot; {r.campSite}
                        {r.role ? ` · ${r.role}` : ''}
                      </span>
                    </>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
