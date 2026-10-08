import { useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import SignaturePad from './SignaturePad';
import { Section, Field, Check, SavedCard, inputCls, nowLocalInput } from './FormBits';

/**
 * Medication / Treatment Event / Near Miss - rebuilt against the real paper
 * form. Once filed it cannot be edited (the backend only ever inserts).
 */

const EVENT_TYPES = ['Extra Dose', 'Wrong Dose', 'Wrong Time', 'Wrong Camper', 'Omission', 'Omission of dose', 'Wrong drug', 'Expired product', 'Wrong treatment'];
const FACTORS = ['Distractions', 'Workload', 'Cross Coverage'];

interface Props {
  initialPatientName?: string;
  onSaved?: () => void;
  onCancel?: () => void;
}

export default function NearMissIncidentForm({ initialPatientName, onSaved, onCancel }: Props) {
  const { user } = useAuth();
  const [camper, setCamper] = useState(initialPatientName ?? '');
  const [dob, setDob] = useState('');
  const [cabin, setCabin] = useState('');
  const [dx, setDx] = useState('');
  const [eventAt, setEventAt] = useState(nowLocalInput());
  const [discoveredAt, setDiscoveredAt] = useState(nowLocalInput());
  const [description, setDescription] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [factors, setFactors] = useState<string[]>([]);
  const [immediate, setImmediate] = useState('');
  const [doctorNotified, setDoctorNotified] = useState('');
  const [noTreatment, setNoTreatment] = useState(false);
  const [treatment, setTreatment] = useState('');
  const [reporter, setReporter] = useState(user?.username ?? '');
  const [reporterSig, setReporterSig] = useState<string | null>(null);
  const [investigation, setInvestigation] = useState('');
  const [medicalPerson, setMedicalPerson] = useState('');
  const [medicalSig, setMedicalSig] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!camper.trim()) e.camper = 'Required.';
    if (!description.trim()) e.description = 'Required.';
    if (types.length === 0) e.types = 'Select at least one.';
    if (!reporter.trim()) e.reporter = 'Required.';
    if (!reporterSig) e.reporterSig = 'Reporter signature is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await apiService.request<{ success: boolean; message?: string }>('incident:save-report', {
        camperName: camper, dob, cabin, primaryDx: dx, eventAt, discoveredAt, description,
        eventTypes: types, contributingFactors: factors, immediateAction: immediate,
        doctorNotified, noTreatmentOrdered: noTreatment, treatmentOrdered: noTreatment ? '' : treatment,
        reporterName: reporter, reporterSignature: reporterSig,
        investigation, medicalPersonName: medicalPerson, medicalPersonSignature: medicalSig,
        filedByUserId: user?.userId,
      });
      if (!res?.success) throw new Error(res?.message);
      await apiService.request('audit:log-event', { userId: user?.userId, action: 'INCIDENT_REPORT_FILED', actionType: 'CREATE', targetTable: 'camper_forms', details: camper });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setErrors({ save: err instanceof Error && err.message ? err.message : "Couldn't file this report. Try again." });
    } finally {
      setSaving(false);
    }
  };

  if (saved) return <SavedCard title="Report filed" note="This report is now locked and cannot be edited. It is recorded in the audit trail." />;

  return (
    <form onSubmit={save} className="mx-auto max-w-3xl space-y-4 pb-12">
      <div>
        <h1 className="text-lg font-semibold text-ink">Medication / Treatment Event / Near Miss</h1>
        <p className="text-xs text-slate-500">Restricted. Cannot be edited once filed.</p>
      </div>

      <Section title="Camper">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Camper name" required error={errors.camper}><input value={camper} onChange={(e) => setCamper(e.target.value)} className={inputCls(errors.camper)} /></Field>
          <Field label="Date of birth"><input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputCls()} /></Field>
          <Field label="Cabin"><input value={cabin} onChange={(e) => setCabin(e.target.value)} className={inputCls()} /></Field>
          <Field label="Primary Dx"><input value={dx} onChange={(e) => setDx(e.target.value)} className={inputCls()} /></Field>
        </div>
      </Section>

      <Section title="Event">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date/time of event"><input type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} className={inputCls()} /></Field>
            <Field label="Date/time of discovery"><input type="datetime-local" value={discoveredAt} onChange={(e) => setDiscoveredAt(e.target.value)} className={inputCls()} /></Field>
          </div>
          <Field label="Description of event" required error={errors.description}>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls(errors.description)} />
          </Field>
          <Field label="Initial impression" required error={errors.types}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {EVENT_TYPES.map((t) => <Check key={t} label={t} checked={types.includes(t)} onChange={() => toggle(types, setTypes, t)} />)}
            </div>
          </Field>
          <Field label="Contributing factors">
            <div className="flex flex-wrap gap-4">
              {FACTORS.map((t) => <Check key={t} label={t} checked={factors.includes(t)} onChange={() => toggle(factors, setFactors, t)} />)}
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Response">
        <div className="space-y-4">
          <Field label="Immediate action taken"><textarea rows={2} value={immediate} onChange={(e) => setImmediate(e.target.value)} className={inputCls()} /></Field>
          <Field label="Notification of Camp Doctor"><textarea rows={2} value={doctorNotified} onChange={(e) => setDoctorNotified(e.target.value)} className={inputCls()} /></Field>
          <Check label="No treatment ordered" checked={noTreatment} onChange={setNoTreatment} />
          {!noTreatment && (
            <Field label="Treatment ordered"><textarea rows={2} value={treatment} onChange={(e) => setTreatment(e.target.value)} className={inputCls()} /></Field>
          )}
        </div>
      </Section>

      <Section title="Reporter">
        <div className="space-y-4">
          <Field label="Name of reporter" required error={errors.reporter}><input value={reporter} onChange={(e) => setReporter(e.target.value)} className={inputCls(errors.reporter)} /></Field>
          <SignaturePad label="Reporter signature" onChange={setReporterSig} error={errors.reporterSig} />
        </div>
      </Section>

      <Section title="Investigation and corrective action plan">
        <div className="space-y-4">
          <Field label="Event investigation and corrective action plan"><textarea rows={3} value={investigation} onChange={(e) => setInvestigation(e.target.value)} className={inputCls()} /></Field>
          <Field label="Medical person"><input value={medicalPerson} onChange={(e) => setMedicalPerson(e.target.value)} className={inputCls()} /></Field>
          <SignaturePad label="Medical person signature" onChange={setMedicalSig} />
        </div>
      </Section>

      {errors.save && <p className="text-sm font-medium text-alert-600">{errors.save}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
        <button type="submit" disabled={saving} className="rounded bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{saving ? 'Filing…' : 'File report'}</button>
      </div>
    </form>
  );
}