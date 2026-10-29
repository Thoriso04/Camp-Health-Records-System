import { useEffect, useState } from 'react';
import { ChevronRight, ClipboardList, Pill } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { RecordKind } from './RecordViewer';

/**
 * A camper's saved medication check-ins and MedShack visits, newest first.
 * Shows dates, names and status only; clinical detail is behind the click
 * (which the backend audits).
 */

interface CheckinSummary {
  id: number;
  createdAt: string;
  signedBy: string;
}

interface VisitSummary {
  id: number;
  visitDatetime: string;
  clinicianName: string;
  clinicianRole: string;
  status: 'draft' | 'final';
}

interface PatientRecordHistoryProps {
  patientId: string;
  onOpen: (kind: RecordKind, id: string) => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? iso : d.toLocaleString();
};

export default function PatientRecordHistory({ patientId, onOpen }: PatientRecordHistoryProps) {
  const { user } = useAuth();
  const [checkins, setCheckins] = useState<CheckinSummary[]>([]);
  const [visits, setVisits] = useState<VisitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiService
      .requestOrThrow<{ medicationCheckins: CheckinSummary[]; visits: VisitSummary[] }>('records:list-for-patient', {
        patientId,
        userId: user?.userId,
      })
      .then((result) => {
        if (cancelled) return;
        setCheckins(result.medicationCheckins ?? []);
        setVisits(result.visits ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load saved records.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, user?.userId]);

  const rowClass =
    'flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-clinical-50 focus-visible:bg-clinical-50';

  return (
    <div className="rounded border border-slate-100 bg-white shadow-card">
      <h3 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-ink">Saved records</h3>

      {loading && <p className="px-5 py-4 text-sm text-slate-500">Loading…</p>}
      {error && <p className="px-5 py-4 text-sm font-medium text-alert-600">{error}</p>}

      {!loading && !error && checkins.length === 0 && visits.length === 0 && (
        <p className="px-5 py-4 text-sm text-slate-500">No medication check-ins or visits have been saved for this camper yet.</p>
      )}

      {!loading && !error && checkins.length > 0 && (
        <div>
          <p className="bg-slate-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Medication check-ins
          </p>
          <ul className="divide-y divide-slate-100">
            {checkins.map((c) => (
              <li key={c.id}>
                <button className={rowClass} onClick={() => onOpen('medication', String(c.id))}>
                  <Pill className="h-4 w-4 text-clinical-500" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{when(c.createdAt)}</span>
                    <span className="block text-xs text-slate-500">Signed by {c.signedBy}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && visits.length > 0 && (
        <div>
          <p className="bg-slate-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            MedShack visits
          </p>
          <ul className="divide-y divide-slate-100">
            {visits.map((v) => (
              <li key={v.id}>
                <button className={rowClass} onClick={() => onOpen('visit', String(v.id))}>
                  <ClipboardList className="h-4 w-4 text-clinical-500" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{when(v.visitDatetime)}</span>
                    <span className="block text-xs text-slate-500">
                      {v.clinicianName} &middot; {v.clinicianRole}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      v.status === 'final' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-600'
                    }`}
                  >
                    {v.status === 'final' ? 'Finalised' : 'Draft'}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
