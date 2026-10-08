import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { AllergyAlertBanner } from './AllergyAlertBanner';
import SignaturePad from './SignaturePad';
import { Section, Field, SavedCard, inputCls, nowLocalInput } from './FormBits';

/**
 * MedShack Visit - rebuilt against the real paper form ("Visit to MedShack").
 * Fields: date/time, organisation, camper name, sex, age, DOB, person
 * accompanying, group, reason, vitals (temp / pulse / BP / O2 sat), medical
 * history, signs and symptoms, findings, treatment table (time / treatment /
 * outcome), advice to the accompanying crew member (2 lines), nursing report,
 * Camp Nurse signature and Camp Doctor/Nurse signature.
 */

interface PatientSummary {
  id: string;
  databaseId?: string;
  name: string;
  dateOfBirth?: string;
  diagnosis: string;
  allergies: string[];
  medicalNotes?: string;
}

interface Props {
  patient: PatientSummary;
  onSaved?: () => void;
  onCancel?: () => void;
}

interface TreatmentRow { time: string; treatment: string; outcome: string }

export default function MedShackVisitRecord({ patient, onSaved, onCancel }: Props) {
  const { user } = useAuth();
  const [visitAt, setVisitAt] = useState(nowLocalInput());
  const [organisation, setOrganisation] = useState('');
  const [sex, setSex] = useState('');
  const [age, setAge] = useState('');
  const [accompanying, setAccompanying] = useState('');
  const [group, setGroup] = useState('');
  const [reason, setReason] = useState('');
  const [temperature, setTemperature] = useState('');
  const [pulse, setPulse] = useState('');
  const [bp, setBp] = useState('');
  const [spo2, setSpo2] = useState('');
  const [history, setHistory] = useState('');
  const [signs, setSigns] = useState('');
  const [findings, setFindings] = useState('');
  const [rows, setRows] = useState<TreatmentRow[]>([{ time: '', treatment: '', outcome: '' }]);
  const [advice1, setAdvice1] = useState('');
  const [advice2, setAdvice2] = useState('');
  const [report, setReport] = useState('');
  const [nurseSig, setNurseSig] = useState<string | null>(null);
  const [doctorSig, setDoctorSig] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setRow = (i: number, k: keyof TreatmentRow, v: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!reason.trim()) e.reason = 'Required.';
    if (!nurseSig) e.nurseSig = 'Camp Nurse signature is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await apiService.request<{ success: boolean; message?: string }>('medshack:save-visit', {
        patientId: patient.databaseId ?? patient.id,
        patientName: patient.name,
        visitAt, organisation, sex, age, accompanying, group, reason,
        vitals: { temperature, pulse, bloodPressure: bp, oxygenSaturation: spo2 },
        history, signs, findings,
        treatments: rows.filter((r) => r.time || r.treatment || r.outcome),
        advice: [advice1, advice2].filter(Boolean),
        nursingReport: report,
        nurseSignature: nurseSig,
        doctorSignature: doctorSig,
        recordedByUserId: user?.userId,
      });
      if (!res?.success) throw new Error(res?.message);
      await apiService.request('audit:log-event', { userId: user?.userId, action: 'MEDSHACK_VISIT_SAVED', actionType: 'CREATE', targetTable: 'camper_forms', details: patient.name });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setErrors({ save: err instanceof Error && err.message ? err.message : "Couldn't save this visit. Try again." });
    } finally {
      setSaving(false);
    }
  };

  if (saved) return <SavedCard title="MedShack visit saved" note={`Recorded for ${patient.name} and logged to the audit trail.`} />;

  return (
    <form onSubmit={save} className="mx-auto max-w-3xl space-y-4 pb-12">
      <AllergyAlertBanner allergies={patient.allergies} diagnosis={patient.diagnosis} medicalNotes={patient.medicalNotes} />
      <h1 className="text-lg font-semibold text-ink">MedShack Visit</h1>

      <Section title="Visit and camper">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date and time"><input type="datetime-local" value={visitAt} onChange={(e) => setVisitAt(e.target.value)} className={inputCls()} /></Field>
          <Field label="Organisation name"><input value={organisation} onChange={(e) => setOrganisation(e.target.value)} className={inputCls()} /></Field>
          <Field label="Camper"><input value={patient.name} readOnly className={`${inputCls()} bg-slate-100`} /></Field>
          <Field label="Date of birth"><input value={patient.dateOfBirth ?? ''} readOnly className={`${inputCls()} bg-slate-100`} /></Field>
          <Field label="Sex">
            <select value={sex} onChange={(e) => setSex(e.target.value)} className={inputCls()}>
              <option value="">Select</option><option>M</option><option>F</option>
            </select>
          </Field>
          <Field label="Age"><input value={age} onChange={(e) => setAge(e.target.value)} className={inputCls()} /></Field>
          <Field label="Person accompanying"><input value={accompanying} onChange={(e) => setAccompanying(e.target.value)} className={inputCls()} /></Field>
          <Field label="Group"><input value={group} onChange={(e) => setGroup(e.target.value)} className={inputCls()} /></Field>
          <Field label="Reason for the visit" required error={errors.reason} className="sm:col-span-2">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls(errors.reason)} />
          </Field>
        </div>
      </Section>

      <Section title="Vital signs">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Temperature"><input value={temperature} onChange={(e) => setTemperature(e.target.value)} className={inputCls()} /></Field>
          <Field label="Pulse"><input value={pulse} onChange={(e) => setPulse(e.target.value)} className={inputCls()} /></Field>
          <Field label="Blood pressure"><input value={bp} onChange={(e) => setBp(e.target.value)} className={inputCls()} /></Field>
          <Field label="Oxygen saturation"><input value={spo2} onChange={(e) => setSpo2(e.target.value)} className={inputCls()} /></Field>
        </div>
      </Section>

      <Section title="Assessment">
        <div className="space-y-4">
          <Field label="Medical history"><textarea rows={2} value={history} onChange={(e) => setHistory(e.target.value)} className={inputCls()} /></Field>
          <Field label="Signs and symptoms"><textarea rows={2} value={signs} onChange={(e) => setSigns(e.target.value)} className={inputCls()} /></Field>
          <Field label="Findings on examination"><textarea rows={2} value={findings} onChange={(e) => setFindings(e.target.value)} className={inputCls()} /></Field>
        </div>
      </Section>

      <Section title="Treatment given">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input type="time" value={r.time} onChange={(e) => setRow(i, 'time', e.target.value)} className={`${inputCls()} col-span-3`} aria-label="Time" />
              <input value={r.treatment} onChange={(e) => setRow(i, 'treatment', e.target.value)} placeholder="Treatment" className={`${inputCls()} col-span-5`} />
              <input value={r.outcome} onChange={(e) => setRow(i, 'outcome', e.target.value)} placeholder="Outcome" className={`${inputCls()} col-span-3`} />
              <button type="button" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="col-span-1 text-slate-500 disabled:opacity-30">
                <Trash2 className="mx-auto h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setRows([...rows, { time: '', treatment: '', outcome: '' }])} className="inline-flex items-center gap-1 text-xs font-semibold text-clinical-600">
            <Plus className="h-3.5 w-3.5" /> Add treatment
          </button>
        </div>
      </Section>

      <Section title="Advice and nursing report">
        <div className="space-y-4">
          <Field label="Advice to crew member accompanying the camper">
            <input value={advice1} onChange={(e) => setAdvice1(e.target.value)} placeholder="1." className={`${inputCls()} mb-2`} />
            <input value={advice2} onChange={(e) => setAdvice2(e.target.value)} placeholder="2." className={inputCls()} />
          </Field>
          <Field label="Nursing report"><textarea rows={4} value={report} onChange={(e) => setReport(e.target.value)} className={inputCls()} /></Field>
        </div>
      </Section>

      <Section title="Signatures">
        <div className="space-y-4">
          <SignaturePad label="Camp Nurse signature" onChange={setNurseSig} error={errors.nurseSig} />
          <SignaturePad label="Camp Doctor/Nurse signature" onChange={setDoctorSig} />
        </div>
      </Section>

      {errors.save && <p className="text-sm font-medium text-alert-600">{errors.save}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
        <button type="submit" disabled={saving} className="rounded bg-clinical-500 px-5 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50">{saving ? 'Saving…' : 'Save visit'}</button>
      </div>
    </form>
  );
}