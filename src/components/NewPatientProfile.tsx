import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * FR-02: Patient Profile Management (create path)
 *
 * "Each profile must include: full name, surname, date of birth,
 * primary diagnosis, known allergies, medical records, and camp
 * session date."
 *
 * This is the piece that was actually missing before today — the app
 * could only search for existing patients (via the hardcoded
 * patient:get-by-id stub), with no way to create one at all.
 *
 * NOTE: calls apiService.request('patient:create', ...), which does
 * NOT exist in electron/main.js yet. Same backend gap as the clinical
 * forms — needs a real handler + database insert.
 */

interface NewPatientProfileProps {
  onSaved?: (patientId: string) => void;
  onCancel?: () => void;
}

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-300 px-2 py-1.5">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded bg-alert-50 px-2 py-0.5 text-xs text-alert-600">
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
  );
}

export default function NewPatientProfile({ onSaved, onCancel }: NewPatientProfileProps) {
  const { user } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [medicalNotes, setMedicalNotes] = useState('');
  const [campSessionDate, setCampSessionDate] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newPatientId, setNewPatientId] = useState('');

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = 'Required.';
    if (!surname.trim()) next.surname = 'Required.';
    if (!dateOfBirth) next.dateOfBirth = 'Required.';
    if (!campSessionDate) next.campSessionDate = 'Required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);

    try {
      const result = await apiService.request<{ id: string }>('patient:create', {
        firstName,
        surname,
        dateOfBirth,
        diagnosis,
        allergies,
        medicalNotes,
        campSessionDate,
        createdByUserId: user?.userId,
      });
      await apiService.request('audit:log-event', {
        userId: user?.userId,
        action: 'PATIENT_PROFILE_CREATED',
      });
      setNewPatientId(result?.id ?? '');
      setSaved(true);
      if (result?.id) onSaved?.(result.id);
    } catch {
      setErrors({ save: "Couldn't create this profile. Check the connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-confirm-500 bg-confirm-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-confirm-600" aria-hidden="true" />
        <p className="font-semibold text-confirm-600">Patient profile created</p>
        <p className="mt-1 text-sm text-slate-700">
          {firstName} {surname}{newPatientId ? ` — ${newPatientId}` : ''} is now searchable from the dashboard.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-2xl space-y-4 pb-12">
      <h1 className="text-lg font-semibold text-ink">New patient profile</h1>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Camper details</h2>
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              First name<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.firstName ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.firstName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.firstName}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Surname<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.surname ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.surname && <p className="mt-1 text-xs font-medium text-alert-600">{errors.surname}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Date of birth<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.dateOfBirth ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.dateOfBirth && <p className="mt-1 text-xs font-medium text-alert-600">{errors.dateOfBirth}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">
              Camp session date<span className="ml-0.5 text-alert-500">*</span>
            </label>
            <input
              type="date"
              value={campSessionDate}
              onChange={(e) => setCampSessionDate(e.target.value)}
              className={`w-full rounded border px-3 py-2 text-sm ${errors.campSessionDate ? 'border-alert-500' : 'border-slate-300'}`}
            />
            {errors.campSessionDate && <p className="mt-1 text-xs font-medium text-alert-600">{errors.campSessionDate}</p>}
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Clinical information</h2>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Primary diagnosis</label>
            <input
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Known allergies</label>
            <TagInput values={allergies} onChange={setAllergies} placeholder="Type an allergy and press Enter" />
            <p className="mt-1 text-xs text-slate-500">
              Leave empty if none — the allergy banner will show "No known allergies" rather than nothing.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Medical notes / records</label>
            <textarea
              value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)}
              rows={3}
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
          className="rounded bg-clinical-500 px-5 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create profile'}
        </button>
      </div>
    </form>
  );
}