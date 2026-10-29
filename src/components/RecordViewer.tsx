import { useEffect, useState } from 'react';
import { ArrowLeft, Lock, Pencil } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * Read-only view of one saved record (medication check-in, MedShack visit,
 * incident report or staff check-in). The backend lays the record out as
 * labelled sections, so every kind renders the same way here. Opening a
 * record writes a READ entry to the audit log on the backend.
 */

export type RecordKind = 'medication' | 'visit' | 'incident' | 'staff';

export interface VisitDraft {
  visitId: string;
  clinicianName: string;
  clinicianRole: string;
  reason: string;
  treatmentProvided: string;
  disposition: string;
  initiatedAt: string;
}

interface RecordData {
  kind: RecordKind;
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
  status: string;
  sections: { heading: string; rows: { label: string; value: string }[] }[];
  signature?: string | null;
  draft?: VisitDraft | null;
}

interface RecordViewerProps {
  kind: RecordKind;
  id: string;
  backLabel?: string;
  onClose: () => void;
  onResumeDraft?: (draft: VisitDraft) => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? iso : d.toLocaleString();
}

export default function RecordViewer({ kind, id, backLabel = 'Back', onClose, onResumeDraft }: RecordViewerProps) {
  const { user } = useAuth();
  const [record, setRecord] = useState<RecordData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiService
      .requestOrThrow<{ record: RecordData }>('records:get', { kind, id, userId: user?.userId })
      .then((result) => {
        if (!cancelled) setRecord(result.record);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't open this record.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id, user?.userId]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button
        onClick={onClose}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-clinical-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {backLabel}
      </button>

      {loading && <p className="text-sm text-slate-500">Opening record…</p>}
      {error && (
        <p role="alert" className="rounded border border-alert-500 bg-alert-50 p-3 text-sm font-medium text-alert-600">
          {error}
        </p>
      )}

      {record && (
        <>
          <div className="rounded border border-slate-100 bg-white p-5 shadow-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-ink">{record.title}</h2>
                <p className="text-sm text-slate-700">{record.subtitle}</p>
                <p className="mt-1 font-mono text-xs text-slate-500">{formatWhen(record.createdAt)}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                {record.status !== 'Draft' && <Lock className="h-3 w-3" aria-hidden="true" />}
                {record.status}
              </span>
            </div>

            {record.draft && onResumeDraft && (
              <button
                onClick={() => onResumeDraft(record.draft as VisitDraft)}
                className="mt-4 inline-flex items-center gap-1.5 rounded bg-clinical-500 px-4 py-2 text-sm font-semibold text-white hover:bg-clinical-600"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Resume this draft
              </button>
            )}
          </div>

          {record.sections.map((section) => (
            <div key={section.heading} className="rounded border border-slate-100 bg-white shadow-card">
              <h3 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-ink">{section.heading}</h3>
              <dl className="divide-y divide-slate-100">
                {section.rows.map((r) => (
                  <div key={r.label} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-3 sm:gap-4">
                    <dt className="text-sm font-medium text-slate-700">{r.label}</dt>
                    <dd className="whitespace-pre-line text-sm text-ink sm:col-span-2">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}

          {record.signature && (
            <div className="rounded border border-slate-100 bg-white p-5 shadow-card">
              <h3 className="mb-2 text-sm font-semibold text-ink">Signature</h3>
              <img
                src={record.signature}
                alt="Signature of the medical person who signed this record"
                className="max-h-32 rounded border border-slate-200 bg-white"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
