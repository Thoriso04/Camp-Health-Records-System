import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * FR-05: Near-Miss and Incident Recording
 * ("Medication/Treatment Event / Near-Miss Form")
 *
 * Per spec:
 * - Mandatory classification: near-miss | medication error | treatment
 *   error | other patient safety incident
 * - Required: date/time, location, patient(s) involved, staff involved,
 *   detailed description, corrective actions (cannot save without text)
 * - Optional: contributing factors, recommendations
 * - Restricted access — gated in MedicalDashboard by the new
 *   FILE_INCIDENT_REPORT permission (see rbac.ts)
 * - "Full reports are stored encrypted and linked to the patient record
 *   for Physician review" — this component sends patientIds in the
 *   payload so the backend can create that link; the encryption itself
 *   happens at the database layer, not here.
 *
 * NOTE: calls apiService.request('incident:save-report', ...), which
 * does NOT exist in electron/main.js yet — same backend gap as the
 * other two forms.
 */

type Classification = 'near-miss' | 'medication-error' | 'treatment-error' | 'other';

const CLASSIFICATIONS: { value: Classification; label: string }[] = [
  { value: 'near-miss', label: 'Near-miss' },
  { value: 'medication-error', label: 'Medication error' },
  { value: 'treatment-error', label: 'Treatment error' },
  { value: 'other', label: 'Other patient safety incident' },
];

interface NearMissIncidentFormProps {
  initialPatientName?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}

function TagInput({
  label,
  required,
  values,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  required?: boolean;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  error?: string;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft('');
  };

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-alert-500">*</span>}
      </label>
      <div className={`flex flex-wrap items-center gap-1.5 rounded border px-2 py-1.5 ${error ? 'border-alert-500' : 'border-slate-300'}`}>
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-clinical-50 px-2 py-0.5 text-xs text-clinical-700">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          placeholder={values.length === 0 ? placeholder : ''}
          className="min-w-[8rem] flex-1 border-none py-0.5 text-sm outline-none"
        />
      </div>
      {error && <p className="mt-1 text-xs font-medium text-alert-600">{error}</p>}
    </div>
  );
}

export default function NearMissIncidentForm({ initialPatientName, onSaved, onCancel }: NearMissIncidentFormProps) {
  const { user } = useAuth();

  const [classification, setClassification] = useState<Classification | ''>('');
  const [dateTime, setDateTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [location, setLocation] = useState('');
  const [patientsInvolved, setPatientsInvolved] = useState<string[]>(initialPatientName ? [initialPatientName] : []);
  const [staffInvolved, setStaffInvolved] = useState<string[]>(user?.username ? [user.username] : []);
  const [description, setDescription] = useState('');
  const [correctiveActions, setCorrectiveActions] = useState('');
  const [contributingFactors, setContributingFactors] = useState('');
  const [recommendations, setRecommendations] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!classification) next.classification = 'Select an incident classification.';
    if (!dateTime) next.dateTime = 'Required.';
    if (!location.trim()) next.location = 'Required.';
    if (patientsInvolved.length === 0) next.patientsInvolved = 'Add at least one patient involved.';
    if (staffInvolved.length === 0) next.staffInvolved = 'Add at least one staff member involved.';
    if (!description.trim()) next.description = 'Required — describe what happened.';
    if (!correctiveActions.trim()) next.correctiveActions = 'Required — cannot save without corrective actions taken.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);

    try {
      await apiService.request('incident:save-report', {
        classification,
        dateTime,
        location,
        patientsInvolved,
        staffInvolved,
        description,
        correctiveActions,
        contributingFactors,
        recommendations,
        reportedByUserId: user?.userId,
      });
      await apiService.request('audit:log-event', {
        userId: user?.userId,
        action: 'INCIDENT_REPORT_FILED',
      });
      setSaved(true);
      onSaved?.();
    } catch {
      setErrors({ save: "Couldn't save this report. Check the connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="mx-auto max-w-3xl rounded border border-confirm-500 bg-confirm-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-confirm-600" aria-hidden="true" />
        <p className="font-semibold text-confirm-600">Incident report filed</p>
        <p className="mt-1 text-sm text-slate-700">
          Encrypted, linked to the patient record, and logged to the audit trail for Physician review.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-3xl space-y-4 pb-12">
      <div className="rounded border-l-[6px] border-amber-500 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-600">Medication/Treatment Event &middot; Near-Miss Form</p>
        <p className="text-xs text-amber-600">Restricted access. Visible to camp medical staff and the Physician only.</p>
      </div>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Classification</h2>
        </header>
        <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-4">
          {CLASSIFICATIONS.map((c) => (
            <label
              key={c.value}
              className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm ${
                classification === c.value ? 'border-clinical-500 bg-clinical-50 text-clinical-700' : 'border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="classification"
                value={c.value}
                checked={classification === c.value}
                onChange={() => setClassification(c.value)}
                className="sr-only"
              />
              {c.label}
            </label>
          ))}
        </div>
        {errors.classification && <p className="px-5 pb-4 text-xs font-medium text-alert-600">{errors.classification}</p>}
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">When and where</h2>
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Date and time<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.dateTime ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.dateTime && <p className="mt-1 text-xs font-medium text-alert-600">{errors.dateTime}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Location<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. MedShack, Cabin 4"
              className={`w-full rounded border px-3 py-2 text-sm ${errors.location ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.location && <p className="mt-1 text-xs font-medium text-alert-600">{errors.location}</p>}
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Who was involved</h2>
        </header>
        <div className="space-y-4 p-5">
          <TagInput
            label="Patient(s) involved"
            required
            values={patientsInvolved}
            onChange={setPatientsInvolved}
            placeholder="Type a name and press Enter"
            error={errors.patientsInvolved}
          />
          <TagInput
            label="Staff involved"
            required
            values={staffInvolved}
            onChange={setStaffInvolved}
            placeholder="Type a name and press Enter"
            error={errors.staffInvolved}
          />
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">What happened</h2>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Detailed description<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.description ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.description && <p className="mt-1 text-xs font-medium text-alert-600">{errors.description}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Contributing factors (optional)</label>
            <textarea
              value={contributingFactors}
              onChange={(e) => setContributingFactors(e.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      <section className="rounded border-2 border-alert-500 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Corrective actions (required)</h2>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Corrective actions taken<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <textarea
              value={correctiveActions}
              onChange={(e) => setCorrectiveActions(e.target.value)}
              rows={3}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.correctiveActions ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.correctiveActions && <p className="mt-1 text-xs font-medium text-alert-600">{errors.correctiveActions}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Recommendations (optional)</label>
            <textarea
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
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
          className="rounded bg-alert-500 px-5 py-2 text-sm font-semibold text-white hover:bg-alert-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'File report'}
        </button>
      </div>
    </form>
  );
}