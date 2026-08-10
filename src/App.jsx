import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import AllergyAlertBanner from './components/AllergyAlertBanner';
import { apiService } from './services/api';

export default function App() {
  const { user, login, logout, isAuthenticated } = useAuth();
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [patientData, setPatientData] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    const response = await apiService.request('auth:login', {
      username: usernameInput,
      password: passwordInput,
    });

    if (response.success && response.token) {
      login(response.token);
      // Create tamper-evident audit log entry on successful login
      await apiService.request('audit:log-event', {
        userId: response.user.userId,
        action: 'USER_LOGIN',
      });
    } else {
      alert(response.message || 'Login failed');
    }
  };

  const fetchSamplePatient = async () => {
    const data = await apiService.request('patient:get-by-id', 'CAMPER-001');
    setPatientData(data);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Header Bar */}
      <header className="bg-indigo-900 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Camp Health Records System</h1>
          <p className="text-xs text-indigo-200">CHRS Offline Desktop App — Encrypted SQLite Layer</p>
        </div>

        <div>
          {isAuthenticated ? (
            <div className="flex items-center gap-4">
              <span className="text-sm">
                User: <strong className="font-semibold">{user?.username}</strong> ({user?.role})
              </span>
              <button
                onClick={logout}
                className="rounded bg-indigo-700 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-600 transition"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <span className="text-xs italic bg-indigo-800 px-2.5 py-1 rounded">Not Authenticated</span>
          )}
        </div>
      </header>

      {/* Workspace */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {!isAuthenticated ? (
          <div className="max-w-md mx-auto mt-12 bg-white p-6 rounded-lg shadow-md border border-slate-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Staff Authenticated Access</h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Username</label>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full border border-slate-300 rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="admin"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Password</label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full border border-slate-300 rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="password123"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 text-white font-semibold py-2 rounded text-sm hover:bg-indigo-700 transition"
              >
                Login & Connect Main Process
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-slate-200">
              <div>
                <h2 className="text-md font-bold text-slate-800">IPC Main Process Connection</h2>
                <p className="text-xs text-slate-500">Test backend database query responses via IPC bridge.</p>
              </div>
              <button
                onClick={fetchSamplePatient}
                className="bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded hover:bg-emerald-700 transition"
              >
                Fetch Record (IPC)
              </button>
            </div>

            {patientData && (
              <AllergyAlertBanner
                allergies={patientData.allergies}
                diagnosis={patientData.diagnosis}
                medicalNotes={patientData.medicalNotes}
              />
            )}

            {/* Team Development Placeholders */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b pb-2 mb-3">Form Digitisation (Juané)</h3>
                <p className="text-xs text-slate-500 mb-4">Place digitized forms here (Check-In, Visits, Med Logs).</p>
                <div className="p-4 border-2 border-dashed border-slate-300 rounded text-center text-xs text-slate-400">
                  Form Components Container
                </div>
              </div>

              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b pb-2 mb-3">RBAC Views (Itumeleng)</h3>
                <p className="text-xs text-slate-500 mb-4">Place role-restricted navigation views here.</p>
                <div className="p-4 border-2 border-dashed border-slate-300 rounded text-center text-xs text-slate-400">
                  Role Action Panel Container
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-slate-200 text-center py-3 text-xs text-slate-600 border-t border-slate-300">
        Camp Health Records System &copy; 2026 — Local Encrypted Storage
      </footer>
    </div>
  );
}