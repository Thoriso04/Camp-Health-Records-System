import { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Checkbox, TagInput } from './NewPatientProfile';

/**
 * Edit an existing camper profile ("Edit record" on the dashboard).
 *
 * Covers the registration and medical pages of the paper form. The signed
 * indemnity/consent and the photo are deliberately not editable here: the
 * signatures are a legal record, and photos have their own physician-only
 * control on the patient card. The main process re-checks the user's role and
 * writes an audit entry (before and after) for every saved change.
 */

interface EditPatientProfileProps {
  patientId: string;
  onSaved: () => void;
  onCancel: () => void;
}

interface Profile {
  id: string;
  firstName: string;
  surname: string;
  dateOfBirth: string;
  campSessionDate: string;
  diagnosis: string;
  allergies: string[];
  currentMedication: string[];
  sex: string;
  tShirtSize: string;
  address: string;
  cellNumber: string;
  languageSpoken: string;
  caregiverName: string;
  caregiverCell: string;
  emergencyContactName: string;
  emergencyContactCell: string;
  emergencyContactRelationship: string;
  clinicFileNumber: string;
  clinicContactDetails: string;
  medicationHandedIn: string;
  viralLoadOver1000: string;
  tbHistory: string;
  hepatitisB: string;
  adherenceBarriers: string;
  dietaryRequirements: string;
  religion: string;
  behavioralNotes: string;
  additionalDisclosures: string;
  linkedSiblingId: string;
  tbScreening: { coughOver2Weeks: boolean; unexplainedWeightLoss: boolean; nightSweatsOrFevers: boolean };
  dailyLivingAssistance: { assistShowerBath: boolean; assistDressing: boolean; assistToileting: boolean; assistEating: boolean };
  accessibility: { eyesight: string; hearing: string; mobilityAids: string; prosthesis: string };
}

const inputClass = (hasError?: boolean) =>
  `w-full rounded border px-3 py-2 text-sm ${hasError ? 'border-alert-500' : 'border-slate-300'}`;

function Field({
  label,
  required,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-alert-500">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs font-medium text-alert-600">{error}</p>}
    </div>
  );
}

function YesNo({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-4">
      {(['yes', 'no'] as const).map((option) => (
        <label key={option} className="flex items-center gap-1.5 text-sm">
          <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} />
          {option === 'yes' ? 'Yes' : 'No'}
        </label>
      ))}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-100 bg-white shadow-card">
      <header className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

export default function EditPatientProfile({ patientId, onSaved, onCancel }: EditPatientProfileProps) {
  const { user } = useAuth();
  const [form, setForm] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await apiService.request<{ success: boolean; profile?: Profile; error?: string }>(
          'patient:get-profile',
          { patientId, userId: user?.userId },
        );
        if (!result?.success || !result.profile) {
          throw new Error(result?.error || "This patient's details could not be loaded.");
        }
        if (!cancelled) setForm(result.profile);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "This patient's details could not be loaded.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, user?.userId]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <p className="text-sm font-medium text-alert-600">{loadError}</p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Back to patient
        </button>
      </div>
    );
  }

  if (!form) {
    return <p className="mx-auto max-w-3xl text-sm text-slate-500">Loading patient details…</p>;
  }

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  const setGroup = <G extends 'tbScreening' | 'dailyLivingAssistance' | 'accessibility'>(
    group: G,
    key: keyof Profile[G],
    value: Profile[G][keyof Profile[G]],
  ) => setForm((current) => (current ? { ...current, [group]: { ...current[group], [key]: value } } : current));
  const textInput = (key: keyof Profile & string, hasError?: boolean) => (
    <input
      value={form[key] as string}
      onChange={(e) => set(key as never, e.target.value as never)}
      className={inputClass(hasError)}
    />
  );

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!form.firstName.trim()) next.firstName = 'Required.';
    if (!form.surname.trim()) next.surname = 'Required.';
    if (!form.dateOfBirth) next.dateOfBirth = 'Required.';
    if (!form.campSessionDate) next.campSessionDate = 'Required.';
    if (!form.caregiverName.trim()) next.caregiverName = 'Required.';
    if (!form.emergencyContactName.trim()) next.emergencyContactName = 'Required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const result = await apiService.request<{ success: boolean; error?: string }>('patient:save-record', {
        patientId,
        userId: user?.userId,
        changes: form,
      });
      if (!result?.success) throw new Error(result?.error || 'The changes could not be saved.');
      onSaved();
    } catch (error) {
      setErrors({
        save: error instanceof Error ? error.message : "Couldn't save these changes. Try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-3xl space-y-4 pb-12">
      <div>
        <h1 className="text-lg font-semibold text-ink">Edit patient record</h1>
        <p className="font-mono text-xs text-slate-500">
          {form.id} &middot; Every change is recorded in the audit log. Signatures and the photo are not edited here.
        </p>
      </div>

      <Section title="Personal information">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.firstName}>{textInput('firstName', !!errors.firstName)}</Field>
          <Field label="Surname" required error={errors.surname}>{textInput('surname', !!errors.surname)}</Field>
          <Field label="Date of birth" required error={errors.dateOfBirth}>
            <input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} className={inputClass(!!errors.dateOfBirth)} />
          </Field>
          <Field label="Sex">{textInput('sex')}</Field>
          <Field label="T-shirt size">{textInput('tShirtSize')}</Field>
          <Field label="Cell number">{textInput('cellNumber')}</Field>
          <Field label="Address" className="sm:col-span-2">{textInput('address')}</Field>
          <Field label="Language spoken">{textInput('languageSpoken')}</Field>
          <Field label="Camp session date" required error={errors.campSessionDate}>
            <input type="date" value={form.campSessionDate} onChange={(e) => set('campSessionDate', e.target.value)} className={inputClass(!!errors.campSessionDate)} />
          </Field>
        </div>
      </Section>

      <Section title="Parent / caregiver & emergency contact">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Parent/caregiver name" required error={errors.caregiverName}>{textInput('caregiverName', !!errors.caregiverName)}</Field>
          <Field label="Caregiver cell">{textInput('caregiverCell')}</Field>
          <Field label="Emergency contact name" required error={errors.emergencyContactName}>{textInput('emergencyContactName', !!errors.emergencyContactName)}</Field>
          <Field label="Emergency contact cell">{textInput('emergencyContactCell')}</Field>
          <Field label="Relationship to child">{textInput('emergencyContactRelationship')}</Field>
        </div>
      </Section>

      <Section title="Medical information" note="Strictly confidential">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Primary diagnosis">{textInput('diagnosis')}</Field>
          <Field label="Clinic/hospital file number">{textInput('clinicFileNumber')}</Field>
          <Field label="Clinic/hospital/doctor contact details" className="sm:col-span-2">{textInput('clinicContactDetails')}</Field>
        </div>
        <Field label="Known allergies">
          <TagInput values={form.allergies} onChange={(v) => set('allergies', v)} placeholder="Type an allergy and press Enter" tone="alert" />
        </Field>
        <Field label="Current medication">
          <TagInput values={form.currentMedication} onChange={(v) => set('currentMedication', v)} placeholder="Type a medication and press Enter" tone="clinical" />
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium text-ink">Medication handed in?</p>
          <YesNo name="editMedHandedIn" value={form.medicationHandedIn} onChange={(v) => set('medicationHandedIn', v)} />
        </div>
      </Section>

      <Section title="Clinical review">
        <div>
          <p className="mb-1 text-sm font-medium text-ink">Viral load &gt; 1000 copies/ml?</p>
          <YesNo name="editViralLoad" value={form.viralLoadOver1000} onChange={(v) => set('viralLoadOver1000', v)} />
        </div>
        <Field label="TB history">
          <select value={form.tbHistory} onChange={(e) => set('tbHistory', e.target.value)} className={inputClass()}>
            <option value="">Select…</option>
            <option value="current">Current</option>
            <option value="past">Past</option>
            <option value="negative">Negative</option>
            <option value="on-treatment">On treatment</option>
            {/* Keep an imported value that isn't one of the standard options. */}
            {form.tbHistory && !['current', 'past', 'negative', 'on-treatment'].includes(form.tbHistory) && (
              <option value={form.tbHistory}>{form.tbHistory}</option>
            )}
          </select>
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium text-ink">Hepatitis B?</p>
          <YesNo name="editHepB" value={form.hepatitisB} onChange={(v) => set('hepatitisB', v)} />
        </div>
        <Field label="Adherence barriers (if any)">
          <textarea value={form.adherenceBarriers} onChange={(e) => set('adherenceBarriers', e.target.value)} rows={2} className={inputClass()} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">TB screening</p>
          <div className="space-y-1.5">
            <Checkbox label="Cough lasting longer than 2 weeks" checked={form.tbScreening.coughOver2Weeks} onChange={(v) => setGroup('tbScreening', 'coughOver2Weeks', v)} />
            <Checkbox label="Unexplained weight loss" checked={form.tbScreening.unexplainedWeightLoss} onChange={(v) => setGroup('tbScreening', 'unexplainedWeightLoss', v)} />
            <Checkbox label="Night sweats or unexplained fevers" checked={form.tbScreening.nightSweatsOrFevers} onChange={(v) => setGroup('tbScreening', 'nightSweatsOrFevers', v)} />
          </div>
        </div>
      </Section>

      <Section title="Accessibility & daily living">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([
            ['eyesight', 'Eyesight'],
            ['hearing', 'Hearing'],
            ['mobilityAids', 'Mobility aids'],
            ['prosthesis', 'Prosthesis'],
          ] as const).map(([key, label]) => (
            <Field key={key} label={label}>
              <input value={form.accessibility[key]} onChange={(e) => setGroup('accessibility', key, e.target.value)} className={inputClass()} />
            </Field>
          ))}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Assistance with daily living</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Checkbox label="Shower/bath" checked={form.dailyLivingAssistance.assistShowerBath} onChange={(v) => setGroup('dailyLivingAssistance', 'assistShowerBath', v)} />
            <Checkbox label="Dressing" checked={form.dailyLivingAssistance.assistDressing} onChange={(v) => setGroup('dailyLivingAssistance', 'assistDressing', v)} />
            <Checkbox label="Toileting" checked={form.dailyLivingAssistance.assistToileting} onChange={(v) => setGroup('dailyLivingAssistance', 'assistToileting', v)} />
            <Checkbox label="Eating" checked={form.dailyLivingAssistance.assistEating} onChange={(v) => setGroup('dailyLivingAssistance', 'assistEating', v)} />
          </div>
        </div>
      </Section>

      <Section title="Additional information">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dietary requirements">{textInput('dietaryRequirements')}</Field>
          <Field label="Religion">{textInput('religion')}</Field>
        </div>
        <Field label="Behavioral / psychosocial / self-care needs">
          <textarea value={form.behavioralNotes} onChange={(e) => set('behavioralNotes', e.target.value)} rows={2} className={inputClass()} />
        </Field>
        <Field label="Additional disclosures">
          <textarea value={form.additionalDisclosures} onChange={(e) => set('additionalDisclosures', e.target.value)} rows={2} className={inputClass()} />
        </Field>
        <Field label="Linked sibling ID (optional)">{textInput('linkedSiblingId')}</Field>
      </Section>

      {errors.save && <p className="text-sm font-medium text-alert-600">{errors.save}</p>}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-clinical-500 px-5 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
