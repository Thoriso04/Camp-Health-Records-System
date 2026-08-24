import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * FR-06: Medical Centre Check-In for Staff and Crew
 *
 * Per spec: full name (auto-populated or selectable), role, camp site,
 * presenting complaint/reason, vital signs (OPTIONAL — unlike the
 * camper form where vitals are required), assessment notes, treatment
 * provided, disposition. Stored SEPARATELY from camper records — never
 * combined in any report or export that leaves the Medical Centre
 * (Section 6, Security). Retention: 12 months, pending legal
 * confirmation (OI-04) — NOT the 10-year camper retention period.
 *
 * NOTE: calls apiService.request('staff:save-checkin', ...), which does
 * NOT exist in electron/main.js yet — same backend gap as the other
 * three forms. This one especially needs its own database table,
 * separate from the campers table, per the spec's storage-separation
 * requirement above.
 */

interface StaffCheckInProps {
  onSaved?: () => void;
  onCancel?: () => void;
}

export default function StaffCheckIn({ onSaved, onCancel }: StaffCheckInProps) {
  const { user } = useAuth();

  const [fullName, setFullName] = useState(user?.username ?? '');
  const [role, setRole] = useState('');
  const [campSite, setCampSite] = useState('');
  const [complaint, setComplaint] = useState('');
  const [temperature, setTemperature] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [assessmentNotes, setAssessmentNotes] = useState('');
  const [treatmentProvided, setTreatmentProvided] = useState('');
  const [disposition, setDisposition] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!fullName.trim()) next.fullName = 'Required.';
    if (!campSite.trim()) next.campSite = 'Required.';
    if (!complaint.trim()) next.complaint = 'Required — reason for visit.';
    if (!disposition.trim()) next.disposition = 'Required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);

    try {
      // Stored in a separate staff_checkins table, never joined with
      // camper records — see Section 6 Security in the tech spec.
      await apiService.request('staff:save-checkin', {
        fullName,
        role,
        campSite,
        complaint,
        vitals: temperature || bloodPressure ? { temperature, bloodPressure } : undefined,
        assessmentNotes,
        treatmentProvided,
        disposition,
        recordedByUserId: user?.userId,
      });
      await apiService.request('audit:log-event', {
        userId: user?.userId,
        action: 'STAFF_CHECKIN_SAVED',
      });
      setSaved(true);
      onSaved?.();
    } catch {
      setErrors({ save: "Couldn't save this check-in. Check the connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-confirm-500 bg-confirm-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-confirm-600" aria-hidden="true" />
        <p className="font-semibold text-confirm-600">Staff check-in saved</p>
        <p className="mt-1 text-sm text-slate-700">
          Stored separately from camper records, retained for 12 months.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-2xl space-y-4 pb-12">
      <div>
        <h1 className="text-lg font-semibold text-ink">Medical Centre Check-In &mdash; Staff and Crew</h1>
        <p className="text-xs text-slate-500">
          Stored separately from camper records. Never combined in any report leaving the Medical Centre.
        </p>
      </div>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Staff details</h2>
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Full name<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.fullName ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.fullName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.fullName}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Role</label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Counselor, Kitchen Staff"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">
              Camp site<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              value={campSite}
              onChange={(e) => setCampSite(e.target.value)}
              placeholder="Gauteng, Free State, Eastern Cape, Western Cape, KwaZulu-Natal"
              className={`w-full rounded border px-3 py-2 text-sm ${errors.campSite ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.campSite && <p className="mt-1 text-xs font-medium text-alert-600">{errors.campSite}</p>}
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Visit</h2>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Presenting complaint / reason for visit<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <textarea
              value={complaint}
              onChange={(e) => setComplaint(e.target.value)}
              rows={2}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.complaint ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.complaint && <p className="mt-1 text-xs font-medium text-alert-600">{errors.complaint}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Temperature (optional)</label>
              <input
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Blood pressure (optional)</label>
              <input
                value={bloodPressure}
                onChange={(e) => setBloodPressure(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Assessment notes</label>
            <textarea
              value={assessmentNotes}
              onChange={(e) => setAssessmentNotes(e.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
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
              Disposition<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              value={disposition}
              onChange={(e) => setDisposition(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.disposition ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.disposition && <p className="mt-1 text-xs font-medium text-alert-600">{errors.disposition}</p>}
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
          type="submit"
          disabled={saving}
          className="rounded bg-clinical-500 px-5 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save check-in'}
        </button>
      </div>
    </form>
  );
}
