import { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

/** Small shared building blocks for the digitised paper forms. */

export const inputCls = (err?: string) =>
  `w-full rounded border px-3 py-2 text-sm bg-white ${err ? 'border-alert-500' : 'border-slate-300'}`;

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-slate-100 bg-white shadow-card">
      <header className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Field({
  label, required, error, children, className = '',
}: { label: string; required?: boolean; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-ink">
        {label}{required && <span className="ml-0.5 text-alert-500">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs font-medium text-alert-600">{error}</p>}
    </div>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function YesNo({ label, value, onChange }: { label: string; value: '' | 'yes' | 'no'; onChange: (v: 'yes' | 'no') => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink">{label}</span>
      <span className="flex gap-3">
        {(['yes', 'no'] as const).map((v) => (
          <label key={v} className="flex items-center gap-1 capitalize">
            <input type="radio" checked={value === v} onChange={() => onChange(v)} /> {v}
          </label>
        ))}
      </span>
    </div>
  );
}

export function SavedCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto max-w-2xl rounded border border-confirm-500 bg-confirm-50 p-6 text-center">
      <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-confirm-600" aria-hidden="true" />
      <p className="font-semibold text-confirm-600">{title}</p>
      <p className="mt-1 text-sm text-slate-700">{note}</p>
    </div>
  );
}

export const nowLocalInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};