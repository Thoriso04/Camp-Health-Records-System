import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiService } from '../services/api';
import { isDoseMissed } from './MedicationLog';

interface Dose { scheduleId: number; medication: string; time: string; patientId: number; patientName: string }

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Camp-wide list of today's overdue, unrecorded doses. Refreshes every minute. */
export default function MissedDosesPanel() {
  const [missed, setMissed] = useState<Dose[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const date = today();
        const res = await apiService.request<{ success: boolean; doses?: Dose[] }>('medlog:today', { date });
        if (alive) setMissed((res?.doses ?? []).filter((d) => isDoseMissed(date, d.time)));
      } catch { /* offline-safe: just show nothing */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (missed.length === 0) return null;
  return (
    <div role="alert" className="rounded border border-alert-500 bg-alert-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-alert-600">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {missed.length} missed medication dose{missed.length > 1 ? 's' : ''} today
      </p>
      <ul className="mt-2 space-y-0.5 text-xs text-alert-600">
        {missed.slice(0, 8).map((d) => (
          <li key={`${d.scheduleId}-${d.time}`}>{d.patientName} &middot; {d.medication} &middot; due {d.time}</li>
        ))}
        {missed.length > 8 && <li>…and {missed.length - 8} more</li>}
      </ul>
    </div>
  );
}