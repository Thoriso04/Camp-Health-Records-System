import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { apiService } from '../services/api';

/**
 * RegisterUser
 *
 * New accounts are created with is_active = 0 (schema.sql default) and
 * cannot log in until an Admin approves them via the Pending Users
 * section on the dashboard. The requested role is stored and shown to
 * the approver, but never trusted for actual permissions until
 * approved — self-declaring "Physician" here does NOT grant Physician
 * access on its own.
 */

const ROLE_OPTIONS = [
  { value: 'camp_physician', label: 'Camp Physician' },
  { value: 'camp_nurse', label: 'Camp Nurse' },
  { value: 'paramedic', label: 'Paramedic' },
  { value: 'camp_administrator', label: 'Camp Administrator' },
];

interface RegisterUserProps {
  onBackToLogin: () => void;
}

export default function RegisterUser({ onBackToLogin }: RegisterUserProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [requestedRole, setRequestedRole] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim() || !username.trim() || !password || !requestedRole) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiService.request<{ success: boolean; message?: string }>('auth:register', {
        fullName,
        username,
        password,
        requestedRole,
      });
      if (result.success) {
        setSubmitted(true);
      } else {
        setError(result.message || 'Registration failed.');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper font-sans">
        <div className="w-full max-w-sm rounded border border-confirm-500 bg-confirm-50 p-6 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-confirm-600" aria-hidden="true" />
          <p className="font-semibold text-confirm-600">Registration submitted</p>
          <p className="mt-1 text-sm text-slate-700">
            Your account is pending approval from an Administrator. You'll be able to log in once approved.
          </p>
          <button
            onClick={onBackToLogin}
            className="mt-4 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper font-sans">
      <div className="w-full max-w-sm overflow-hidden rounded border border-slate-100 bg-white shadow-card">
        <div className="h-1.5 bg-lime-400" />
        <div className="p-6">
          <h1 className="text-lg font-semibold text-ink">Register</h1>
          <p className="mb-6 mt-1 text-xs text-slate-500">
            Your account will be reviewed before you can log in.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Full name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">I am registering as a</label>
              <select value={requestedRole} onChange={(e) => setRequestedRole(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm">
                <option value="">Select…</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                An Administrator will confirm this before your account is active.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Confirm password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>

            {error && <p className="text-xs font-medium text-alert-600" role="alert">{error}</p>}

            <button type="submit" disabled={submitting} className="w-full rounded bg-footprints-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-footprints-700 disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Register'}
            </button>
            <button type="button" onClick={onBackToLogin} className="w-full text-xs font-medium text-clinical-600 hover:underline">
              Already have an account? Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}