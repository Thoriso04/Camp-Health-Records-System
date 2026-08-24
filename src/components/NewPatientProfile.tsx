import { useState } from 'react';
import { CheckCircle2, X, Camera } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import SignaturePad from './SignaturePad';

/**
 * Camper Check-In Form
 *
 * Rebuilt against the ACTUAL paper forms (Camper Registration and
 * Indemnity forms.pdf, Crew Indemnity.pdf) and the client Q&A doc
 * received 24 Aug 2026 — this resolves OI-02 in the FSD. Fields below
 * follow the paper form's own section order: Personal Information,
 * Parent/Caregiver, Medical Information, Clinical Review, then the
 * Indemnity/Consent section with signatures.
 *
 * REAL GAPS vs. the original build, now fixed:
 * - Photo capture (client Q&A: "Take a photo of the child")
 * - Accessibility fields: eyesight, hearing, mobility aids, prosthesis
 * - Assistance with daily living (shower/bath, dressing, toileting, eating)
 * - TB screening flags (cough >2wks, weight loss, night sweats)
 * - Viral load / TB / Hepatitis B / adherence barriers (HIV-specific care)
 * - Medication handed-in tracking, separate from the medication list
 * - Religion, dietary requirements, behavioral/psychosocial notes as
 *   DISTINCT fields (previously lumped into one free-text box)
 * - Sibling linking
 * - Legal indemnity consent with an actual signature (parent + witness)
 *
 * STILL OPEN, deliberately not solved here — needs a team decision:
 * - Whether canvas-based signatures satisfy the legal/POPIA bar, or a
 *   real e-signature provider is required (see SignaturePad.tsx)
 * - Multi-year profile persistence (client wants records to follow a
 *   child across camps/years — this form still creates a single
 *   session-scoped profile; the underlying data model needs to change
 *   for this, which is a database/backend decision, not a form-field one)
 * - The 5-year vs. 10-year retention conflict between the client Q&A
 *   and the FSD
 *
 * NOTE: calls apiService.request('patient:create', ...), still not a
 * real IPC handler.
 */

interface NewPatientProfileProps {
  onSaved?: (patientId: string) => void;
  onCancel?: () => void;
}

function TagInput({
  values,
  onChange,
  placeholder,
  tone = 'alert',
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  tone?: 'alert' | 'clinical';
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft('');
  };
  const chipClass = tone === 'alert' ? 'bg-alert-50 text-alert-600' : 'bg-clinical-50 text-clinical-700';
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-300 px-2 py-1.5">
      {values.map((v) => (
        <span key={v} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${chipClass}`}>
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

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export default function NewPatientProfile({ onSaved, onCancel }: NewPatientProfileProps) {
  const { user } = useAuth();

  // Personal information
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState('');
  const [tShirtSize, setTShirtSize] = useState('');
  const [address, setAddress] = useState('');
  const [cellNumber, setCellNumber] = useState('');
  const [languageSpoken, setLanguageSpoken] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [campSessionDate, setCampSessionDate] = useState('');

  // Parent/caregiver + emergency contact
  const [caregiverName, setCaregiverName] = useState('');
  const [caregiverCell, setCaregiverCell] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactCell, setEmergencyContactCell] = useState('');
  const [emergencyContactRelationship, setEmergencyContactRelationship] = useState('');

  // Medical information
  const [diagnosis, setDiagnosis] = useState('');
  const [clinicFileNumber, setClinicFileNumber] = useState('');
  const [clinicContactDetails, setClinicContactDetails] = useState('');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [currentMedication, setCurrentMedication] = useState<string[]>([]);
  const [medicationHandedIn, setMedicationHandedIn] = useState<'yes' | 'no' | ''>('');

  // Clinical review (HIV-specific per the real paper form)
  const [viralLoadOver1000, setViralLoadOver1000] = useState<'yes' | 'no' | ''>('');
  const [tbHistory, setTbHistory] = useState('');
  const [hepatitisB, setHepatitisB] = useState<'yes' | 'no' | ''>('');
  const [adherenceBarriers, setAdherenceBarriers] = useState('');

  // TB screening flags
  const [coughOver2Weeks, setCoughOver2Weeks] = useState(false);
  const [unexplainedWeightLoss, setUnexplainedWeightLoss] = useState(false);
  const [nightSweatsOrFevers, setNightSweatsOrFevers] = useState(false);

  // Accessibility / daily living
  const [eyesight, setEyesight] = useState('');
  const [hearing, setHearing] = useState('');
  const [mobilityAids, setMobilityAids] = useState('');
  const [prosthesis, setProsthesis] = useState('');
  const [assistShowerBath, setAssistShowerBath] = useState(false);
  const [assistDressing, setAssistDressing] = useState(false);
  const [assistToileting, setAssistToileting] = useState(false);
  const [assistEating, setAssistEating] = useState(false);

  // Additional
  const [dietaryRequirements, setDietaryRequirements] = useState('');
  const [religion, setReligion] = useState('');
  const [behavioralNotes, setBehavioralNotes] = useState('');
  const [additionalDisclosures, setAdditionalDisclosures] = useState('');
  const [linkedSiblingId, setLinkedSiblingId] = useState('');

  // Indemnity / consent
  const [guardianName, setGuardianName] = useState('');
  const [consentToDisclosure, setConsentToDisclosure] = useState(false);
  const [consentToMediaRelease, setConsentToMediaRelease] = useState(false);
  const [guardianSignature, setGuardianSignature] = useState<string | null>(null);
  const [witnessName, setWitnessName] = useState('');
  const [witnessSignature, setWitnessSignature] = useState<string | null>(null);

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
    if (!caregiverName.trim()) next.caregiverName = 'Required.';
    if (!emergencyContactName.trim()) next.emergencyContactName = 'Required.';
    if (!guardianName.trim()) next.guardianName = 'Required for indemnity consent.';
    if (!consentToDisclosure) next.consentToDisclosure = 'Consent to disclosure is required.';
    if (!guardianSignature) next.guardianSignature = 'Signature required — no child may attend without a signed indemnity form.';
    if (!witnessName.trim()) next.witnessName = 'Required.';
    if (!witnessSignature) next.witnessSignature = 'Witness signature required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);

    try {
      const result = await apiService.request<{ id: string }>('patient:create', {
        firstName, surname, dateOfBirth, sex, tShirtSize, address, cellNumber, languageSpoken,
        photoDataUrl, campSessionDate,
        caregiverName, caregiverCell,
        emergencyContactName, emergencyContactCell, emergencyContactRelationship,
        diagnosis, clinicFileNumber, clinicContactDetails, allergies, currentMedication, medicationHandedIn,
        viralLoadOver1000, tbHistory, hepatitisB, adherenceBarriers,
        tbScreening: { coughOver2Weeks, unexplainedWeightLoss, nightSweatsOrFevers },
        accessibility: { eyesight, hearing, mobilityAids, prosthesis },
        dailyLivingAssistance: { assistShowerBath, assistDressing, assistToileting, assistEating },
        dietaryRequirements, religion, behavioralNotes, additionalDisclosures, linkedSiblingId,
        consent: {
          guardianName, consentToDisclosure, consentToMediaRelease,
          guardianSignature, witnessName, witnessSignature,
          signedAt: new Date().toISOString(),
        },
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
        <p className="font-semibold text-confirm-600">Camper check-in complete</p>
        <p className="mt-1 text-sm text-slate-700">
          {firstName} {surname}{newPatientId ? ` — ${newPatientId}` : ''} is now searchable from the dashboard.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-3xl space-y-4 pb-12">
      <div>
        <h1 className="text-lg font-semibold text-ink">Camper Check-In Form</h1>
        <p className="text-xs text-slate-500">Built against the real Registration &amp; Indemnity paper form</p>
      </div>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Personal information</h2>
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <label className="col-span-full flex cursor-pointer items-center gap-3 rounded border-2 border-dashed border-slate-300 p-3 text-sm text-slate-500 hover:border-clinical-500">
            <Camera className="h-5 w-5" aria-hidden="true" />
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="Camper" className="h-12 w-12 rounded object-cover" />
            ) : (
              'Add photo'
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setPhotoDataUrl(reader.result as string);
                reader.readAsDataURL(file);
              }}
            />
          </label>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">First name<span className="ml-0.5 text-alert-500">*</span></label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.firstName ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.firstName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.firstName}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Surname<span className="ml-0.5 text-alert-500">*</span></label>
            <input value={surname} onChange={(e) => setSurname(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.surname ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.surname && <p className="mt-1 text-xs font-medium text-alert-600">{errors.surname}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Date of birth<span className="ml-0.5 text-alert-500">*</span></label>
            <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.dateOfBirth ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.dateOfBirth && <p className="mt-1 text-xs font-medium text-alert-600">{errors.dateOfBirth}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Sex</label>
            <input value={sex} onChange={(e) => setSex(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">T-shirt size</label>
            <input value={tShirtSize} onChange={(e) => setTShirtSize(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Cell number</label>
            <input value={cellNumber} onChange={(e) => setCellNumber(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Language spoken</label>
            <input value={languageSpoken} onChange={(e) => setLanguageSpoken(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink">Camp session date<span className="ml-0.5 text-alert-500">*</span></label>
            <input type="date" value={campSessionDate} onChange={(e) => setCampSessionDate(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.campSessionDate ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.campSessionDate && <p className="mt-1 text-xs font-medium text-alert-600">{errors.campSessionDate}</p>}
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Parent / caregiver &amp; emergency contact</h2>
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Parent/caregiver name<span className="ml-0.5 text-alert-500">*</span></label>
            <input value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.caregiverName ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.caregiverName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.caregiverName}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Caregiver cell</label>
            <input value={caregiverCell} onChange={(e) => setCaregiverCell(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Emergency contact name<span className="ml-0.5 text-alert-500">*</span></label>
            <input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.emergencyContactName ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.emergencyContactName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.emergencyContactName}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Emergency contact cell</label>
            <input value={emergencyContactCell} onChange={(e) => setEmergencyContactCell(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Relationship to child</label>
            <input value={emergencyContactRelationship} onChange={(e) => setEmergencyContactRelationship(e.target.value)} placeholder="e.g. Aunt" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Medical information</h2>
          <p className="text-xs text-slate-500">Strictly confidential</p>
        </header>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Primary diagnosis</label>
              <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Clinic/hospital file number</label>
              <input value={clinicFileNumber} onChange={(e) => setClinicFileNumber(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-ink">Clinic/hospital/doctor contact details</label>
              <input value={clinicContactDetails} onChange={(e) => setClinicContactDetails(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Known allergies</label>
            <TagInput values={allergies} onChange={setAllergies} placeholder="Type an allergy and press Enter" tone="alert" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Current medication</label>
            <TagInput values={currentMedication} onChange={setCurrentMedication} placeholder="Type a medication and press Enter" tone="clinical" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-ink">Medication handed in?</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="medHandedIn" checked={medicationHandedIn === 'yes'} onChange={() => setMedicationHandedIn('yes')} /> Yes</label>
              <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="medHandedIn" checked={medicationHandedIn === 'no'} onChange={() => setMedicationHandedIn('no')} /> No</label>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Clinical review</h2>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <p className="mb-1 text-sm font-medium text-ink">Viral load &gt; 1000 copies/ml?</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="viralLoad" checked={viralLoadOver1000 === 'yes'} onChange={() => setViralLoadOver1000('yes')} /> Yes</label>
              <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="viralLoad" checked={viralLoadOver1000 === 'no'} onChange={() => setViralLoadOver1000('no')} /> No</label>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">TB history</label>
            <select value={tbHistory} onChange={(e) => setTbHistory(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select…</option>
              <option value="current">Current</option>
              <option value="past">Past</option>
              <option value="negative">Negative</option>
              <option value="on-treatment">On treatment</option>
            </select>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-ink">Hepatitis B?</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="hepB" checked={hepatitisB === 'yes'} onChange={() => setHepatitisB('yes')} /> Yes</label>
              <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="hepB" checked={hepatitisB === 'no'} onChange={() => setHepatitisB('no')} /> No</label>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Adherence barriers (if any)</label>
            <textarea value={adherenceBarriers} onChange={(e) => setAdherenceBarriers(e.target.value)} rows={2} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">TB screening</p>
            <div className="space-y-1.5">
              <Checkbox label="Cough lasting longer than 2 weeks" checked={coughOver2Weeks} onChange={setCoughOver2Weeks} />
              <Checkbox label="Unexplained weight loss" checked={unexplainedWeightLoss} onChange={setUnexplainedWeightLoss} />
              <Checkbox label="Night sweats or unexplained fevers" checked={nightSweatsOrFevers} onChange={setNightSweatsOrFevers} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Accessibility &amp; daily living</h2>
        </header>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Assistance with daily living</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Checkbox label="Shower/bath" checked={assistShowerBath} onChange={setAssistShowerBath} />
              <Checkbox label="Dressing" checked={assistDressing} onChange={setAssistDressing} />
              <Checkbox label="Toileting" checked={assistToileting} onChange={setAssistToileting} />
              <Checkbox label="Eating" checked={assistEating} onChange={setAssistEating} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-100 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Additional information</h2>
        </header>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Dietary requirements</label>
              <input value={dietaryRequirements} onChange={(e) => setDietaryRequirements(e.target.value)} placeholder="Diabetic, halaal, vegetarian…" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Religion</label>
              <input value={religion} onChange={(e) => setReligion(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Behavioral / psychosocial / self-care needs</label>
            <textarea value={behavioralNotes} onChange={(e) => setBehavioralNotes(e.target.value)} rows={2} placeholder="e.g. bedwetting, sleepwalking" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Additional disclosures</label>
            <textarea value={additionalDisclosures} onChange={(e) => setAdditionalDisclosures(e.target.value)} rows={2} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Linked sibling ID (optional)</label>
            <input value={linkedSiblingId} onChange={(e) => setLinkedSiblingId(e.target.value)} placeholder="e.g. CAMPER-014" className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
      </section>

      <section className="rounded border-2 border-clinical-500 bg-white shadow-card">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Indemnity &amp; consent (required)</h2>
          <p className="text-xs text-alert-600">No child will be accepted to camp if this section is incomplete.</p>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Parent/guardian full name<span className="ml-0.5 text-alert-500">*</span></label>
            <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.guardianName ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.guardianName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.guardianName}</p>}
          </div>
          <Checkbox label="I consent to disclosure of clinical records to Just Footprints Foundation." checked={consentToDisclosure} onChange={setConsentToDisclosure} />
          {errors.consentToDisclosure && <p className="text-xs font-medium text-alert-600">{errors.consentToDisclosure}</p>}
          <Checkbox label="I consent to photo/video media release." checked={consentToMediaRelease} onChange={setConsentToMediaRelease} />

          <SignaturePad label="Parent/guardian signature" onChange={setGuardianSignature} error={errors.guardianSignature} />

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Witness name<span className="ml-0.5 text-alert-500">*</span></label>
            <input value={witnessName} onChange={(e) => setWitnessName(e.target.value)} className={`w-full rounded border px-3 py-2 text-sm ${errors.witnessName ? 'border-alert-500' : 'border-slate-300'}`} />
            {errors.witnessName && <p className="mt-1 text-xs font-medium text-alert-600">{errors.witnessName}</p>}
          </div>
          <SignaturePad label="Witness signature" onChange={setWitnessSignature} error={errors.witnessSignature} />
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
          {saving ? 'Creating…' : 'Complete check-in'}
        </button>
      </div>
    </form>
  );
}