import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, X } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/rbac';
import { AllergyAlertBanner } from './AllergyAlertBanner';

/**
 * Medications and Treatments - weekly administration log (the paper
 * "Medication and treatment table"). One row per medication, a column per
 * day (Sun-Sat), up to 4 dose times per day. Medical staff tap a dose to
 * record Given / Refused; a dose that is past due with nothing recorded is
 * flagged MISSED automatically (client request: "should the system flag
 * anything automatically, e.g. a missed medication? Yes").
 */

interface PatientSummary {
  id: string;
  databaseId: string;
  name: string;
  diagnosis: string;
  allergies: string[];
  medicalNotes?: string;
}

interface ScheduleRow {
  id: number;
  medication: string;
  dose: string | null;
  times: string[]; // "HH:MM", max 4
}

interface DoseRecord {
  schedule_id: number;
  dose_date: string;
  dose_time: string;
  status: 'given' | 'refused';
  note: string | null;
  administered_by: string | null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GRACE_MINUTES = 60;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function startOfWeek(d: Date) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - s.getDay());
  return s;
}

export function isDoseMissed(date: string, time: string, now: Date = new Date()) {
  const due = new Date(`${date}T${time}:00`);
  return now.getTime() - due.getTime() > GRACE_MINUTES * 60 * 1000;
}

export default function MedicationLog({ patient, onClose }: { patient: PatientSummary; onClose: () => void }) {
  const { user } = useAuth();
  const canEdit = hasPermission(user?.role, 'EDIT_CLINICAL_RECORDS');

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [records, setRecords] = useState<DoseRecord[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ s: ScheduleRow; date: string; time: string } | null>(null);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [newMed, setNewMed] = useState('');
  const [newDose, setNewDose] = useState('');
  const [newTimes, setNewTimes] = useState<string[]>(['08:00']);
  const [now, setNow] = useState(new Date());

  const days = useMemo(
    () => DAYS.map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }),
    [weekStart],
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiService.request<{ success: boolean; schedules?: ScheduleRow[]; records?: DoseRecord[]; message?: string }>(
        'medlog:get',
        { patientId: patient.databaseId, from: iso(days[0]), to: iso(days[6]) },
      );
      if (!res?.success) throw new Error(res?.message || 'Could not load the medication log.');
      setSchedules(res.schedules ?? []);
      setRecords(res.records ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the medication log.');
    }
  }, [patient.databaseId, days]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  const find = (sid: number, date: string, time: string) =>
    records.find((r) => r.schedule_id === sid && r.dose_date === date && r.dose_time === time);

  const record = async (status: 'given' | 'refused') => {
    if (!selected) return;
    const res = await apiService.request<{ success: boolean; message?: string }>('medlog:record', {
      scheduleId: selected.s.id,
      patientId: patient.databaseId,
      date: selected.date,
      time: selected.time,
      status,
      note: note.trim() || null,
      userId: user?.userId,
    });
    if (!res?.success) { setError(res?.message || 'Could not save.'); return; }
    await apiService.request('audit:log-event', {
      userId: user?.userId,
      action: `MEDICATION_${status.toUpperCase()}`,
      actionType: 'UPDATE',
      targetTable: 'med_administration',
      targetId: String(selected.s.id),
      details: `${selected.s.medication} ${selected.date} ${selected.time}`,
    });
    setSelected(null);
    setNote('');
    load();
  };

  const addSchedule = async () => {
    if (!newMed.trim()) { setError('Enter a medication name.'); return; }
    const res = await apiService.request<{ success: boolean; message?: string }>('medlog:add-schedule', {
      patientId: patient.databaseId,
      medication: newMed.trim(),
      dose: newDose.trim() || null,
      times: newTimes.filter(Boolean).slice(0, 4),
      userId: user?.userId,
    });
    if (!res?.success) { setError(res?.message || 'Could not add medication.'); return; }
    setAdding(false); setNewMed(''); setNewDose(''); setNewTimes(['08:00']);
    load();
  };

  const missed = useMemo(() => {
    const out: string[] = [];
    for (const s of schedules) for (const d of days) for (const t of s.times) {
      const date = iso(d);
      if (!find(s.id, date, t) && isDoseMissed(date, t, now)) out.push(`${s.medication} ${t} (${date})`);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, records, days, now]);

  return (
    <div className="space-y-4">
      <AllergyAlertBanner allergies={patient.allergies} diagnosis={patient.diagnosis} medicalNotes={patient.medicalNotes} />

      <div className="rounded border border-slate-100 bg-white p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Medications and Treatments</h2>
            <p className="text-xs text-slate-500">{patient.name} &middot; Diagnosis: {patient.diagnosis || 'Not recorded'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); }}
              className="rounded border border-slate-300 p-1.5 hover:bg-slate-50" aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-xs font-medium text-slate-700">Week of {iso(days[0])}</span>
            <button onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); }}
              className="rounded border border-slate-300 p-1.5 hover:bg-slate-50" aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
            <button onClick={onClose} className="ml-2 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Close</button>
          </div>
        </div>

        {error && <p className="mb-3 text-sm font-medium text-alert-600">{error}</p>}

        {missed.length > 0 && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded border border-alert-500 bg-alert-50 p-3 text-sm text-alert-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{missed.length} missed dose{missed.length > 1 ? 's' : ''} this week</p>
              <p className="text-xs">{missed.slice(0, 6).join(' · ')}{missed.length > 6 ? ' …' : ''}</p>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="w-44 border border-slate-300 p-2 text-left">Medication / time</th>
                {days.map((d, i) => (
                  <th key={i} className="border border-slate-300 p-2 text-center">
                    <div>{DAYS[i]}</div>
                    <div className="font-mono font-normal text-slate-500">{iso(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.length === 0 && (
                <tr><td colSpan={8} className="border border-slate-300 p-6 text-center text-slate-500">No medication scheduled for this patient yet.</td></tr>
              )}
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="border border-slate-300 p-2 align-top">
                    <p className="font-semibold text-ink">{s.medication}</p>
                    {s.dose && <p className="text-slate-500">{s.dose}</p>}
                  </td>
                  {days.map((d) => {
                    const date = iso(d);
                    return (
                      <td key={date} className="border border-slate-300 p-1 align-top">
                        <div className="flex flex-wrap gap-1">
                          {s.times.map((t) => {
                            const r = find(s.id, date, t);
                            const isMissed = !r && isDoseMissed(date, t, now);
                            const cls = r
                              ? r.status === 'given' ? 'border-confirm-500 bg-confirm-50 text-confirm-600' : 'border-amber-500 bg-amber-50 text-amber-600'
                              : isMissed ? 'border-alert-500 bg-alert-50 text-alert-600 font-semibold' : 'border-slate-300 bg-white text-slate-700';
                            return (
                              <button
                                key={t}
                                disabled={!canEdit || !!r}
                                onClick={() => { setSelected({ s, date, time: t }); setNote(''); }}
                                title={r ? `${r.status} by ${r.administered_by ?? '?'}${r.note ? ` - ${r.note}` : ''}` : isMissed ? 'Missed' : 'Pending'}
                                className={`rounded border px-1.5 py-1 font-mono ${cls} disabled:cursor-default`}
                              >
                                {t}{r ? (r.status === 'given' ? ' ✓' : ' R') : isMissed ? ' !' : ''}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">✓ given &middot; R refused &middot; ! missed (more than {GRACE_MINUTES} min late, nothing recorded). Recorded doses cannot be edited.</p>

        {selected && canEdit && (
          <div className="mt-4 rounded border border-clinical-500 bg-clinical-50 p-4">
            <div className="mb-2 flex items-start justify-between">
              <p className="text-sm font-semibold text-ink">{selected.s.medication} &middot; {selected.date} at {selected.time}</p>
              <button onClick={() => setSelected(null)} aria-label="Cancel"><X className="h-4 w-4 text-slate-500" /></button>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (e.g. child felt nauseous)"
              className="mb-3 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => record('given')} className="rounded bg-confirm-500 px-4 py-2 text-sm font-semibold text-white hover:bg-confirm-600">Mark given</button>
              <button onClick={() => record('refused')} className="rounded border border-amber-500 bg-white px-4 py-2 text-sm font-semibold text-amber-600 hover:bg-amber-50">Refused</button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Recorded as {user?.username} at the current time.</p>
          </div>
        )}

        {canEdit && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            {!adding ? (
              <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-clinical-600 hover:bg-clinical-50">
                <Plus className="h-3.5 w-3.5" /> Add medication
              </button>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={newMed} onChange={(e) => setNewMed(e.target.value)} placeholder="Medication" className="rounded border border-slate-300 px-3 py-2 text-sm" />
                <input value={newDose} onChange={(e) => setNewDose(e.target.value)} placeholder="Dose (e.g. 1 tablet)" className="rounded border border-slate-300 px-3 py-2 text-sm" />
                <div className="sm:col-span-2">
                  <p className="mb-1 text-xs text-slate-500">Dose times per day (up to 4)</p>
                  <div className="flex flex-wrap gap-2">
                    {newTimes.map((t, i) => (
                      <input key={i} type="time" value={t} onChange={(e) => setNewTimes(newTimes.map((x, j) => (j === i ? e.target.value : x)))}
                        className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    ))}
                    {newTimes.length < 4 && (
                      <button onClick={() => setNewTimes([...newTimes, '12:00'])} className="rounded border border-slate-300 px-2 py-1.5 text-xs">+ time</button>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <button onClick={addSchedule} className="rounded bg-clinical-500 px-4 py-2 text-sm font-semibold text-white hover:bg-clinical-600">Save medication</button>
                  <button onClick={() => setAdding(false)} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}