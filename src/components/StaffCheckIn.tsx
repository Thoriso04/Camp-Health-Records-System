import { useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import SignaturePad from './SignaturePad';
import { Section, Field, YesNo, SavedCard, inputCls } from './FormBits';

/**
 * Medical Centre Check-In - Staff / Crew Members. Rebuilt against the real
 * paper form ("Medical Check In Crew"). Stored in a separate staff table,
 * never joined to camper records.
 */

type YN = '' | 'yes' | 'no';
const today = () => new Date().toISOString().slice(0, 10);

interface Props { onSaved?: () => void; onCancel?: () => void }

export default function StaffCheckIn({ onSaved, onCancel }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [allergies, setAllergies] = useState<YN>('');
  const [allergyDetail, setAllergyDetail] = useState('');
  const [broviac, setBroviac] = useState<YN>('');
  const [f, setF] = useState<Record<string, string>>({});
  const [tb, setTb] = useState<Record<string, string>>({});
  const [adl, setAdl] = useState<Record<string, string>>({});
  const [medication, setMedication] = useState<YN>('');
  const [bloodCount, setBloodCount] = useState<YN>('');
  const [bloodDate, setBloodDate] = useState('');
  const [comments, setComments] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [crewSig, setCrewSig] = useState<string | null>(null);
  const [crewDate, setCrewDate] = useState(today());
  const [medName, setMedName] = useState(user?.username ?? '');
  const [medSig, setMedSig] = useState<string | null>(null);
  const [medDate, setMedDate] = useState(today());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (obj: Record<string, string>, fn: (v: Record<string, string>) => void, k: string, v: string) => fn({ ...obj, [k]: v });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Required.';
    if (!agreed) e.agreed = 'The crew member must accept the medical release policy.';
    if (!crewSig) e.crewSig = 'Crew member signature is required.';
    if (!medSig) e.medSig = 'Medical person signature is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await apiService.request<{ success: boolean; message?: string }>('staff:save-checkin', {
        name, dob, allergies, allergyDetail, broviac, screening: f, tbScreening: tb, dailyLiving: adl,
        medication, bloodCount, bloodDate, comments,
        releaseAccepted: agreed, crewSignature: crewSig, crewDate, medicalPersonName: medName, medicalPersonSignature: medSig, medicalDate: medDate,
        recordedByUserId: user?.userId,
      });
      if (!res?.success) throw new Error(res?.message);
      await apiService.request('audit:log-event', { userId: user?.userId, action: 'STAFF_CHECKIN_SAVED', actionType: 'CREATE', targetTable: 'staff_forms' });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setErrors({ save: err instanceof Error && err.message ? err.message : "Couldn't save. Try again." });
    } finally {
      setSaving(false);
    }
  };

  if (saved) return <SavedCard title="Staff check-in saved" note="Stored separately from camper records." />;

  const detail = (label: string, key: string, obj: Record<string, string>, fn: (v: Record<string, string>) => void) => (
    <Field label={label}><input value={obj[key] ?? ''} onChange={(e) => set(obj, fn, key, e.target.value)} className={inputCls()} /></Field>
  );

  return (
    <form onSubmit={save} className="mx-auto max-w-3xl space-y-4 pb-12">
      <div>
        <h1 className="text-lg font-semibold text-ink">Medical Centre Check-In &mdash; Staff / Crew Members</h1>
        <p className="text-xs text-slate-500">Stored separately from camper records.</p>
      </div>

      <Section title="Crew member">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls(errors.name)} /></Field>
          <Field label="Date of birth"><input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputCls()} /></Field>
        </div>
      </Section>

      <Section title="Health">
        <div className="space-y-4">
          <YesNo label="Allergies" value={allergies} onChange={setAllergies} />
          {allergies === 'yes' && <Field label="Which allergies?"><input value={allergyDetail} onChange={(e) => setAllergyDetail(e.target.value)} className={inputCls()} /></Field>}
          <YesNo label="Broviac / Port-a-cath" value={broviac} onChange={setBroviac} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {detail('Eyesight', 'eyesight', f, setF)}
            {detail('Hearing', 'hearing', f, setF)}
            {detail('Mobility aids', 'mobility', f, setF)}
            {detail('Prosthesis', 'prosthesis', f, setF)}
            {detail('Other', 'other', f, setF)}
          </div>
        </div>
      </Section>

      <Section title="Screening">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {detail('A cough that lasts longer than 2 weeks', 'cough', tb, setTb)}
          {detail('Unexplained weight loss', 'weightLoss', tb, setTb)}
          {detail('Night sweats or unexplained fevers', 'sweats', tb, setTb)}
        </div>
      </Section>

      <Section title="Assistance with daily living">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {detail('Shower / Bath', 'shower', adl, setAdl)}
          {detail('Dressing', 'dressing', adl, setAdl)}
          {detail('Toileting', 'toileting', adl, setAdl)}
          {detail('Eating', 'eating', adl, setAdl)}
        </div>
      </Section>

      <Section title="Medication">
        <div className="space-y-4">
          <YesNo label="Medication" value={medication} onChange={setMedication} />
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-[14rem] flex-1"><YesNo label="Blood count" value={bloodCount} onChange={setBloodCount} /></div>
            <Field label="Date"><input type="date" value={bloodDate} onChange={(e) => setBloodDate(e.target.value)} className={inputCls()} /></Field>
          </div>
          <Field label="Other comments"><textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} className={inputCls()} /></Field>
          <p className="rounded bg-slate-100 p-3 text-xs text-slate-700">
            Camp staff, volunteers and visitors must have their meds stored and dispensed by the camp medical staff during camp.
            Prior to camp, the Medical Leader fills out a Medical Intake Card listing any medications taken regularly, including vitamins, ARVs and supplements.
          </p>
        </div>
      </Section>

      <Section title="Medical release policy for volunteers and staff">
        <div className="space-y-3 text-sm text-slate-700">
          <p>In case of accident or illness, medical services may be provided by the camp medical staff. The doctor or nurse will refer a staff/camp crew member to other medical services when, in his/her professional judgment, such a referral is necessary.</p>
          <p>In the event of an emergency arising from a serious illness or injury, if the staff/camp crew member is unable to give consent, the camp medical staff is authorized to carry out any medical or surgical procedures which he/she deems necessary for the wellbeing of the staff member.</p>
          <label className="flex items-start gap-2 font-medium text-ink">
            <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            I have read, understand, and agree to abide by the above. I attest that I am physically fit for camp and there are no medical restrictions that would limit my ability to perform the essential functions of my job. I understand that Camp Footprints assumes no responsibility for any pre-existing injury or illness.
          </label>
          {errors.agreed && <p className="text-xs font-medium text-alert-600">{errors.agreed}</p>}
          <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
            <div className="space-y-3">
              <SignaturePad label="Camp crew signature" onChange={setCrewSig} error={errors.crewSig} />
              <Field label="Date"><input type="date" value={crewDate} onChange={(e) => setCrewDate(e.target.value)} className={inputCls()} /></Field>
            </div>
            <div className="space-y-3">
              <Field label="Medical person name"><input value={medName} onChange={(e) => setMedName(e.target.value)} className={inputCls()} /></Field>
              <SignaturePad label="Medical person signature" onChange={setMedSig} error={errors.medSig} />
              <Field label="Date"><input type="date" value={medDate} onChange={(e) => setMedDate(e.target.value)} className={inputCls()} /></Field>
            </div>
          </div>
        </div>
      </Section>

      {errors.save && <p className="text-sm font-medium text-alert-600">{errors.save}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
        <button type="submit" disabled={saving} className="rounded bg-clinical-500 px-5 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50">{saving ? 'Saving…' : 'Save check-in'}</button>
      </div>
    </form>
  );
}