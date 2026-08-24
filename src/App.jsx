import { useAuth } from './context/AuthContext';
import { apiService } from './services/api';
import { useState } from 'react';
import MedicalDashboard from './components/MedicalDashboard';
import { LockScreenModal } from './components/LockScreenModal';
import { useInactivityTimer } from './hooks/useInactivityTimer';

// FR-01: "The system must lock the user session after 10 minutes of
// inactivity." Session-lock timeout, not the JWT expiry — those are two
// different things and shouldn't be confused.
const SESSION_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

export default function App() {
  const { login, isAuthenticated } = useAuth();
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLocked, setIsLocked] = useState(false);

  useInactivityTimer(() => {
    if (isAuthenticated) setIsLocked(true);
  }, SESSION_LOCK_TIMEOUT_MS);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    const response = await apiService.request('auth:login', {
      username: usernameInput,
      password: passwordInput,
    });

    if (response.success && response.token) {
      login(response.token);
      await apiService.request('audit:log-event', {
        userId: response.user.userId,
        action: 'USER_LOGIN',
      });
    } else {
      setLoginError(response.message || 'Login failed. Check your username and password.');
    }
  };

  if (isAuthenticated) {
    return (
      <>
        <MedicalDashboard />
        <LockScreenModal isLocked={isLocked} onUnlock={() => setIsLocked(false)} />
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper font-sans">
      <div className="w-full max-w-sm overflow-hidden rounded border border-slate-100 bg-white shadow-card">
        <div className="h-1.5 bg-lime-400" />
        <div className="p-6">
        <h1 className="text-lg font-semibold text-ink">Camp Health Records System</h1>
        <p className="mb-1 mt-1 text-xs text-slate-500">
          CHRS offline desktop app &mdash; encrypted SQLite layer
        </p>
        <p className="mb-6 text-xs font-medium text-footprints-600">Camp Footprints</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="admin"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="password123"
            />
          </div>

          {loginError && (
            <p className="text-xs font-medium text-alert-600" role="alert">
              {loginError}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded bg-footprints-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-footprints-700"
          >
            Sign in
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}