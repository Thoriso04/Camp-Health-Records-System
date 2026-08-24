import { useState } from 'react';
import { Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { AllergyAlertBanner } from './AllergyAlertBanner';

/**
 * FR-03: Camper Medication Check-In and Assessment
 *
 * Mirrors the existing paper form (per FSD 7.1 — UI must mirror paper
 * layout). Sections, in paper-form order:
 *   1. Patient details (auto-populated, read-only)
 *   2. Medication table
 *   3. Initial Physical Assessment
 *   4. Clinician sign-off (mandatory — blocks save until complete)
 *
 * OPEN ISSUE (OI-01 in the FSD): the Foundation hasn't provided the
 * final medication/dosage list yet, so "medication name" is free text
 * for now rather than a dropdown. Once OI-01 is resolved, swap the
 * input for a <select> or searchable combobox sourced from that list.
 *
 * NOTE: this calls apiService.request('medication:save-checkin', ...),
 * which does NOT exist in electron/main.js yet — there's no IPC handler
 * for it. Whoever owns the backend/database side (Juané?) needs to add
 * one. The shape it should accept is the SavePayload type below.
 */

interface PatientSummary {
  id: string;
  name: string;
  dateOfBirth?: string;
  diagnosis: string;
  allergies: string[];
}

interface MedicationRow {
  id: string;
  name: string;
  dosage: string;
  route: string;
  frequency: string;
  lastDoseTaken: string;
  verified: boolean;
}

interface SavePayload {
  patientId: string;
  medications: MedicationRow[];
  vitals: { temperature: string; bloodPressure: string; pulse: string; respiratoryRate: string };
  generalAppearance: string;
  newSymptoms: string;
  clinicianName: string;
  clinicianUserId?: string;
}

interface MedicationCheckInProps {
  patient: PatientSummary;
  onSaved?: () => void;
  onCancel?: () => void;
}

const emptyRow = (): MedicationRow => ({
  id: crypto.randomUUID(),
  name: '',
  dosage: '',
  route: '',
  frequency: '',
  lastDoseTaken: '',
  verified: false,
});

export default function MedicationCheckIn({ patient, onSaved, onCancel }: MedicationCheckInProps) {
  const { user } = useAuth();

  const [medications, setMedications] = useState<MedicationRow[]>([emptyRow()]);
  const [temperature, setTemperature] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [pulse, setPulse] = useState('');
  const [respiratoryRate, setRespiratoryRate] = useState('');
  const [generalAppearance, setGeneralAppearance] = useState('');
  const [newSymptoms, setNewSymptoms] = useState('');
  const [clinicianName, setClinicianName] = useState(user?.username ?? '');
  const [confirmed, setConfirmed] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateRow = (id: string, field: keyof MedicationRow, value: string | boolean) => {
    setMedications((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const addRow = () => setMedications((rows) => [...rows, emptyRow()]);

  const removeRow = (id: string) => {
    setMedications((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    medications.forEach((row, i) => {
      const hasAnyValue = row.name || row.dosage || row.route || row.frequency;
      if (hasAnyValue && (!row.name || !row.dosage || !row.route || !row.frequency)) {
        next[`med-${i}`] = 'Complete every field in this row, or remove it.';
      }
    });

    if (!temperature.trim()) next.temperature = 'Required.';
    if (!bloodPressure.trim()) next.bloodPressure = 'Required.';
    if (!pulse.trim()) next.pulse = 'Required.';
    if (!respiratoryRate.trim()) next.respiratoryRate = 'Required.';
    if (!clinicianName.trim()) next.clinicianName = 'Sign-off name is required before saving.';
    if (!confirmed) next.confirmed = 'You must confirm this assessment before saving.';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    const payload: SavePayload = {
      patientId: patient.id,
      medications: medications.filter((r) => r.name.trim()),
      vitals: { temperature, bloodPressure, pulse, respiratoryRate },
      generalAppearance,
      newSymptoms,
      clinicianName,
      clinicianUserId: user?.userId,
    };

    try {
      await apiService.request('medication:save-checkin', payload);
      await apiService.request('audit:log-event', {
        userId: user?.userId,
        action: 'MEDICATION_CHECKIN_SAVED',
      });
      setSaved(true);
      onSaved?.();
    } catch {
      setErrors({ save: "Couldn't save this record. Check the connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  // Once saved, the record becomes permanent and view-only (per FR-03) —
  // no more editing, just a confirmation state.
  if (saved) {
    return (
      <div className="mx-auto max-w-3xl rounded border border-confirm-500 bg-confirm-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-confirm-600" aria-hidden="true" />
        <p className="font-semibold text-confirm-600">Medication check-in saved</p>
        <p className="mt-1 text-sm text-slate-700">
          This record is now permanent and view-only. The save was logged to the audit trail.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-3xl space-y-4 pb-12">
      <AllergyAlertBanner allergies={patient.allergies} diagnosis={patient.diagnosis} />

      <h1 className="text-lg font-semibold text-ink">Camper Medication Check-In and Assessment</h1>

      {/* Section 1: patient details, auto-populated */}
      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="flex items-baseline gap-3 border-b border-slate-100 px-5 py-3">
          <span className="font-mono text-sm font-semibold text-clinical-500">01</span>
          <h2 className="text-sm font-semibold text-ink">Patient details</h2>
        </header>
        <div className="grid grid-cols-2 gap-4 p-5 text-sm">
          <div>
            <p className="text-xs font-medium text-slate-500">Full name</p>
            <p className="text-ink">{patient.name}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Date of birth</p>
            <p className="text-ink">{patient.dateOfBirth ?? 'Not on file'}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs font-medium text-slate-500">Primary diagnosis</p>
            <p className="text-ink">{patient.diagnosis}</p>
          </div>
        </div>
      </section>

      {/* Section 2: medication table */}
      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-sm font-semibold text-clinical-500">02</span>
            <h2 className="text-sm font-semibold text-ink">Medication table</h2>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-clinical-600 hover:bg-clinical-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add medication
          </button>
        </header>
        <div className="space-y-3 p-5">
          {medications.map((row, i) => (
            <div key={row.id} className="rounded border border-slate-100 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <input
                  value={row.name}
                  onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                  placeholder="Medication name"
                  aria-label="Medication name"
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2"
                />
                <input
                  value={row.dosage}
                  onChange={(e) => updateRow(row.id, 'dosage', e.target.value)}
                  placeholder="Dosage"
                  aria-label="Dosage"
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <input
                  value={row.route}
                  onChange={(e) => updateRow(row.id, 'route', e.target.value)}
                  placeholder="Route (oral, topical…)"
                  aria-label="Route"
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <input
                  value={row.frequency}
                  onChange={(e) => updateRow(row.id, 'frequency', e.target.value)}
                  placeholder="Frequency / time"
                  aria-label="Frequency or time"
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <input
                  value={row.lastDoseTaken}
                  onChange={(e) => updateRow(row.id, 'lastDoseTaken', e.target.value)}
                  placeholder="Last dose taken (optional)"
                  aria-label="Last dose taken"
                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={row.verified}
                    onChange={(e) => updateRow(row.id, 'verified', e.target.checked)}
                  />
                  Verified
                </label>
                {medications.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    aria-label="Remove this medication row"
                    className="text-slate-500 hover:text-alert-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {errors[`med-${i}`] && (
                <p className="mt-1 text-xs font-medium text-alert-600">{errors[`med-${i}`]}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: initial physical assessment */}
      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="flex items-baseline gap-3 border-b border-slate-100 px-5 py-3">
          <span className="font-mono text-sm font-semibold text-clinical-500">03</span>
          <h2 className="text-sm font-semibold text-ink">Initial physical assessment</h2>
        </header>
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <FieldInput label="Temperature" required value={temperature} onChange={setTemperature} error={errors.temperature} />
          <FieldInput label="Blood pressure" required value={bloodPressure} onChange={setBloodPressure} error={errors.bloodPressure} />
          <FieldInput label="Pulse" required value={pulse} onChange={setPulse} error={errors.pulse} />
          <FieldInput label="Respiratory rate" required value={respiratoryRate} onChange={setRespiratoryRate} error={errors.respiratoryRate} />
          <div className="col-span-2 sm:col-span-4">
            <label className="mb-1 block text-sm font-medium text-ink">General appearance</label>
            <textarea
              value={generalAppearance}
              onChange={(e) => setGeneralAppearance(e.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2 sm:col-span-4">
            <label className="mb-1 block text-sm font-medium text-ink">New symptoms</label>
            <textarea
              value={newSymptoms}
              onChange={(e) => setNewSymptoms(e.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Section 4: mandatory clinician sign-off */}
      <section className="rounded border-2 border-clinical-500 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Clinician sign-off (required)</h2>
        </header>
        <div className="space-y-3 p-5">
          <FieldInput label="Clinician name" required value={clinicianName} onChange={setClinicianName} error={errors.clinicianName} />
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            I confirm this assessment is accurate and complete to the best of my knowledge.
          </label>
          {errors.confirmed && <p className="text-xs font-medium text-alert-600">{errors.confirmed}</p>}
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

function FieldInput({
  label,
  required,
  value,
  onChange,
  error,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-alert-500">*</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded border px-3 py-2 text-sm ${error ? 'border-alert-500' : 'border-slate-300'}`}
      />
      {error && <p className="mt-1 text-xs font-medium text-alert-600">{error}</p>}
    </div>
  );
}