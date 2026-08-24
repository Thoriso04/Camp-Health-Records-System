import { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface PendingUser {
  id: number;
  username: string;
  full_name: string;
  role: string;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  camp_physician: 'Camp Physician',
  camp_nurse: 'Camp Nurse',
  paramedic: 'Paramedic',
  camp_administrator: 'Camp Administrator',
};

export default function PendingUsersApproval() {
  const { user } = useAuth();
  const [pending, setPending] = useState<PendingUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await apiService.request<PendingUser[]>('user:list-pending', {});
      setPending(Array.isArray(result) ? result : []);
    } finally {
      setLoading(false);
    }
  };

  const approve = async (id: number) => {
    setApprovingId(id);
    try {
      await apiService.request('user:approve', { userId: id });
      await apiService.request('audit:log-event', { userId: user?.userId, action: 'USER_ACCOUNT_APPROVED' });
      setPending((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="rounded border border-slate-100 bg-white shadow-card">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Pending user approvals</h3>
          <p className="text-xs text-slate-500">New registrations wait here until confirmed</p>
        </div>
        <button onClick={load} disabled={loading} className="rounded bg-clinical-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-clinical-600 disabled:opacity-50">
          {loading ? 'Loading…' : pending ? 'Refresh' : 'Load'}
        </button>
      </header>

      <div className="p-5">
        {!pending && <p className="text-sm text-slate-500">Load to check for new registrations.</p>}
        {pending && pending.length === 0 && <p className="text-sm text-slate-500">No pending registrations.</p>}
        {pending && pending.length > 0 && (
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded border border-slate-100 p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{p.full_name} <span className="font-mono text-xs text-slate-500">@{p.username}</span></p>
                  <p className="text-xs text-slate-500">Requested: {ROLE_LABELS[p.role] ?? p.role}</p>
                </div>
                <button
                  onClick={() => approve(p.id)}
                  disabled={approvingId === p.id}
                  className="inline-flex items-center gap-1.5 rounded bg-confirm-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-confirm-600 disabled:opacity-50"
                >
                  <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {approvingId === p.id ? 'Approving…' : `Approve as ${ROLE_LABELS[p.role] ?? p.role}`}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}