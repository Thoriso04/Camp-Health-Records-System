import { useState } from 'react';
import { CheckCircle2, Save } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { AllergyAlertBanner } from './AllergyAlertBanner';

/**
 * FR-04: MedShack Visit Record
 *
 * "The template must automatically record the date and time of
 * initiation. Users select the patient from a searchable list; allergy
 * alert and diagnosis display prominently. The form must include
 * clinician name and role. Records may be saved as draft or finalised.
 * All completed records are linked to the patient profile and viewable
 * in chronological order."
 *
 * NOTE: calls apiService.request('medshack:save-visit', ...), which
 * does NOT exist in electron/main.js yet — same gap as
 * medication:save-checkin in MedicationCheckIn.tsx. Needs a backend
 * handler before this can actually persist anything.
 */

interface PatientSummary {
  id: string;
  name: string;
  allergies: string[];
  diagnosis: string;
}

interface MedShackVisitRecordProps {
  patient: PatientSummary;
  onSaved?: () => void;
  onCancel?: () => void;
}

type Status = 'draft' | 'final';

export default function MedShackVisitRecord({ patient, onSaved, onCancel }: MedShackVisitRecordProps) {
  const { user } = useAuth();
  const initiatedAt = useState(() => new Date())[0];

  const [clinicianName, setClinicianName] = useState(user?.username ?? '');
  const [clinicianRole, setClinicianRole] = useState(user?.role ?? '');
  const [reason, setReason] = useState('');
  const [treatmentProvided, setTreatmentProvided] = useState('');
  const [disposition, setDisposition] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedStatus, setSavedStatus] = useState<Status | null>(null);

  const validateForFinal = (): boolean => {
    const next: Record<string, string> = {};
    if (!clinicianName.trim()) next.clinicianName = 'Required.';
    if (!reason.trim()) next.reason = 'Required.';
    if (!disposition.trim()) next.disposition = 'Required to finalise.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (status: Status) => {
    if (status === 'final' && !validateForFinal()) return;
    setErrors({});
    setSaving(true);

    try {
      await apiService.request('medshack:save-visit', {
        patientId: patient.id,
        status,
        initiatedAt: initiatedAt.toISOString(),
        clinicianName,
        clinicianRole,
        reason,
        treatmentProvided,
        disposition,
      });
      await apiService.request('audit:log-event', {
        userId: user?.userId,
        action: status === 'final' ? 'MEDSHACK_VISIT_FINALISED' : 'MEDSHACK_VISIT_DRAFT_SAVED',
      });
      setSavedStatus(status);
      if (status === 'final') onSaved?.();
    } catch {
      setErrors({ save: "Couldn't save this visit record. Check the connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  if (savedStatus === 'final') {
    return (
      <div className="mx-auto max-w-3xl rounded border border-confirm-500 bg-confirm-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-confirm-600" aria-hidden="true" />
        <p className="font-semibold text-confirm-600">MedShack visit record finalised</p>
        <p className="mt-1 text-sm text-slate-700">
          Linked to {patient.name}'s profile and logged to the audit trail.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-12">
      <AllergyAlertBanner allergies={patient.allergies} diagnosis={patient.diagnosis} />

      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-ink">MedShack Visit Record</h1>
        <p className="font-mono text-xs text-slate-500">
          Initiated {initiatedAt.toLocaleString()}
        </p>
      </div>

      {savedStatus === 'draft' && (
        <p className="rounded border border-amber-500 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-600">
          Draft saved. This record is not yet finalised — continue editing or finalise when ready.
        </p>
      )}

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Patient</h2>
        </header>
        <div className="p-5 text-sm">
          <p className="text-ink">{patient.name}</p>
          <p className="font-mono text-xs text-slate-500">{patient.id}</p>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Attending clinician</h2>
        </header>
        <div className="grid grid-cols-2 gap-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Name<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              value={clinicianName}
              onChange={(e) => setClinicianName(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.clinicianName ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.clinicianName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.clinicianName}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Role</label>
            <input
              value={clinicianRole}
              onChange={(e) => setClinicianRole(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Visit details</h2>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Reason for visit<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.reason ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.reason && <p className="mt-1 text-xs font-medium text-alert-600">{errors.reason}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Treatment provided</label>
            <textarea
              value={treatmentProvided}
              onChange={(e) => setTreatmentProvided(e.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Disposition (returned to activity, sent to hospital, etc.)
              <span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              value={disposition}
              onChange={(e) => setDisposition(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.disposition ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.disposition && <p className="mt-1 text-xs font-medium text-alert-600">{errors.disposition}</p>}
            <p className="mt-1 text-xs text-slate-500">Required to finalise — optional while saving as a draft.</p>
          </div>
        </div>
      </section>

      {errors.save && <p className="text-sm font-medium text-alert-600">{errors.save}</p>}

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => handleSave('draft')}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          Save draft
        </button>
        <button
          type="button"
          onClick={() => handleSave('final')}
          disabled={saving}
          className="rounded bg-clinical-500 px-5 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Finalise visit'}
        </button>
      </div>
    </div>
  );
}