import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { AllergyAlertBanner } from './AllergyAlertBanner';
import SignaturePad from './SignaturePad';

/**
 * Camper Medication Check-In and Assessment
 *
 * REBUILT against the real paper form (Fwd__Medical_forms.zip, received
 * 24 Aug 2026), which is materially different from both the FSD's own
 * description of FR-03 and the first version of this component. The
 * real form has NO medication table with dosage/route/frequency
 * columns and NO "vital signs" section — instead:
 *
 * Name/DOB, allergies Y/N, eyesight/hearing/mobility aids/prosthesis,
 * assistance with daily living, TB screening flags, medication Y/N +
 * handed-in Y/N + date, a simple numbered list of up to 5 current
 * medications, current physical condition, dietary requirements,
 * additional camper info/behavioral notes, and a medical person
 * signature + date.
 *
 * These accessibility/daily-living/TB-screening fields were originally
 * (incorrectly) placed on the Camper Check-In form — removed from
 * there, since the real Registration/Indemnity form doesn't have them
 * at all. They belong here.
 *
 * NOTE: apiService.request('medication:save-checkin', ...) still not a
 * real IPC handler.
 */

interface PatientSummary {
  id: string;
  name: string;
  dateOfBirth?: string;
  diagnosis: string;
  allergies: string[];
}

interface MedicationCheckInProps {
  patient: PatientSummary;
  onSaved?: () => void;
  onCancel?: () => void;
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export default function MedicationCheckIn({ patient, onSaved, onCancel }: MedicationCheckInProps) {
  const { user } = useAuth();

  const [eyesight, setEyesight] = useState('');
  const [hearing, setHearing] = useState('');
  const [mobilityAids, setMobilityAids] = useState('');
  const [prosthesis, setProsthesis] = useState('');
  const [otherAccessibility, setOtherAccessibility] = useState('');

  const [assistShowerBath, setAssistShowerBath] = useState(false);
  const [assistDressing, setAssistDressing] = useState(false);
  const [assistToileting, setAssistToileting] = useState(false);
  const [assistEating, setAssistEating] = useState(false);

  const [coughOver2Weeks, setCoughOver2Weeks] = useState(false);
  const [unexplainedWeightLoss, setUnexplainedWeightLoss] = useState(false);
  const [nightSweatsOrFevers, setNightSweatsOrFevers] = useState(false);

  const [onMedication, setOnMedication] = useState<'yes' | 'no' | ''>('');
  const [medicationHandedIn, setMedicationHandedIn] = useState<'yes' | 'no' | ''>('');
  const [medicationHandedInDate, setMedicationHandedInDate] = useState('');
  const [currentMedications, setCurrentMedications] = useState(['', '', '', '', '']);

  const [physicalCondition, setPhysicalCondition] = useState('');
  const [dietaryRequirements, setDietaryRequirements] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');

  const [medicalPersonName, setMedicalPersonName] = useState(user?.username ?? '');
  const [medicalPersonSignature, setMedicalPersonSignature] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateMedication = (i: number, value: string) => {
    setCurrentMedications((meds) => meds.map((m, idx) => (idx === i ? value : m)));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!medicalPersonName.trim()) next.medicalPersonName = 'Required.';
    if (!medicalPersonSignature) next.medicalPersonSignature = 'Signature required before this record can be saved.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);

    try {
      await apiService.request('medication:save-checkin', {
        patientId: patient.id,
        accessibility: { eyesight, hearing, mobilityAids, prosthesis, other: otherAccessibility },
        dailyLivingAssistance: { assistShowerBath, assistDressing, assistToileting, assistEating },
        tbScreening: { coughOver2Weeks, unexplainedWeightLoss, nightSweatsOrFevers },
        onMedication,
        medicationHandedIn,
        medicationHandedInDate,
        currentMedications: currentMedications.filter((m) => m.trim()),
        physicalCondition,
        dietaryRequirements,
        additionalInfo,
        medicalPersonName,
        medicalPersonSignature,
        signedAt: new Date().toISOString(),
      });
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

  if (saved) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-confirm-500 bg-confirm-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-confirm-600" aria-hidden="true" />
        <p className="font-semibold text-confirm-600">Medication check-in saved</p>
        <p className="mt-1 text-sm text-slate-700">This record is now permanent and view-only.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-2xl space-y-4 pb-12">
      <AllergyAlertBanner allergies={patient.allergies} diagnosis={patient.diagnosis} />

      <div>
        <h1 className="text-lg font-semibold text-ink">Camper Medication Check-In and Assessment</h1>
        <p className="font-mono text-xs text-slate-500">{patient.name} &middot; {patient.dateOfBirth ?? 'DOB not on file'}</p>
      </div>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Accessibility</h2>
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Eyesight</label>
            <input value={eyesight} onChange={(e) => setEyesight(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Hearing</label>
            <input value={hearing} onChange={(e) => setHearing(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Mobility aids</label>
            <input value={mobilityAids} onChange={(e) => setMobilityAids(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Prosthesis</label>
            <input value={prosthesis} onChange={(e) => setProsthesis(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">Other</label>
            <input value={otherAccessibility} onChange={(e) => setOtherAccessibility(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Assistance with daily living &amp; TB screening</h2>
        </header>
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
          <Checkbox label="Shower/bath" checked={assistShowerBath} onChange={setAssistShowerBath} />
          <Checkbox label="Dressing" checked={assistDressing} onChange={setAssistDressing} />
          <Checkbox label="Toileting" checked={assistToileting} onChange={setAssistToileting} />
          <Checkbox label="Eating" checked={assistEating} onChange={setAssistEating} />
        </div>
        <div className="space-y-1.5 border-t border-slate-100 p-5">
          <Checkbox label="Cough lasting longer than 2 weeks" checked={coughOver2Weeks} onChange={setCoughOver2Weeks} />
          <Checkbox label="Unexplained weight loss" checked={unexplainedWeightLoss} onChange={setUnexplainedWeightLoss} />
          <Checkbox label="Night sweats or unexplained fevers" checked={nightSweatsOrFevers} onChange={setNightSweatsOrFevers} />
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Medication</h2>
        </header>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="mb-1 text-sm font-medium text-ink">On medication?</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="onMed" checked={onMedication === 'yes'} onChange={() => setOnMedication('yes')} /> Yes</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="onMed" checked={onMedication === 'no'} onChange={() => setOnMedication('no')} /> No</label>
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-ink">Medication handed in?</p>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="handedIn" checked={medicationHandedIn === 'yes'} onChange={() => setMedicationHandedIn('yes')} /> Yes</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="handedIn" checked={medicationHandedIn === 'no'} onChange={() => setMedicationHandedIn('no')} /> No</label>
                <input type="date" value={medicationHandedInDate} onChange={(e) => setMedicationHandedInDate(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
              </div>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Current medication (list)</p>
            <div className="space-y-2">
              {currentMedications.map((med, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-4 text-xs text-slate-500">{i + 1}</span>
                  <input value={med} onChange={(e) => updateMedication(i, e.target.value)} className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Additional information</h2>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Current physical condition</label>
            <textarea value={physicalCondition} onChange={(e) => setPhysicalCondition(e.target.value)} rows={2} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Dietary requirements</label>
            <input value={dietaryRequirements} onChange={(e) => setDietaryRequirements(e.target.value)} placeholder="Diabetic, halaal, vegetarian…" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Additional camper info (behavioral, psychosocial, self-care needs)</label>
            <textarea value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)} rows={2} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
      </section>

      <section className="rounded border-2 border-clinical-500 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Medical person sign-off (required)</h2>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Medical person name<span className="ml-0.5 text-alert-500">*</span></label>
            <input value={medicalPersonName} onChange={(e) => setMedicalPersonName(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.medicalPersonName ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.medicalPersonName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.medicalPersonName}</p>}
          </div>
          <SignaturePad label="Medical person signature" onChange={setMedicalPersonSignature} error={errors.medicalPersonSignature} />
        </div>
      </section>

      {errors.save && <p className="text-sm font-medium text-alert-600">{errors.save}</p>}

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        )}
        <button type="submit" disabled={saving} className="rounded bg-clinical-500 px-5 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save check-in'}
        </button>
      </div>
    </form>
  );
}