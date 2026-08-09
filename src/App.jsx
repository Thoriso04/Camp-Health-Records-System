import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import AllergyAlertBanner from './components/AllergyAlertBanner';
import { apiService } from './services/api';

export default function App() {
  const { user, login, logout, isAuthenticated } = useAuth();
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  // Mock patient state for layout testing
  const [activePatient, setActivePatient] = useState({
    name: 'Sample Camper (Alex)',
    allergies: ['Penicillin', 'Peanuts'],
    diagnosis: 'Asthma',
    medicalNotes: 'Keep inhaler accessible at all times.'
  });

  const handleLogin = async (e) => {
    e.preventDefault();
    const response = await apiService.request('auth:login', {
      username: usernameInput,
      password: passwordInput,
    });

    if (response.success && response.token) {
      login(response.token);
    } else {
      alert(response.message || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="bg-indigo-900 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Camp Health Records System</h1>
          <p className="text-xs text-indigo-200">CHRS Offline Desktop App</p>
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

      {/* Main Content Workspace */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {!isAuthenticated ? (
          /* Login View Placeholder */
          <div className="max-w-md mx-auto mt-12 bg-white p-6 rounded-lg shadow-md border border-slate-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Staff Login</h2>
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
                Login
              </button>
            </form>
          </div>
        ) : (
          /* Authenticated Dashboard & Forms Placeholder Workspace */
          <div className="space-y-6">
            {/* High-Visibility Allergy Alert Banner Demo */}
            <AllergyAlertBanner
              allergies={activePatient.allergies}
              diagnosis={activePatient.diagnosis}
              medicalNotes={activePatient.medicalNotes}
            />

            {/* Placeholder Sections for Collaborators */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Form Digitisation Module Placeholder (Juané) */}
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b pb-2 mb-3">
                  Clinical Forms (Juané)
                </h3>
                <p className="text-xs text-slate-500 mb-4">
                  Placeholder container for digitized forms (Camper Check-in, MedShack Visits, Medication Logs).
                </p>
                <div className="p-4 border-2 border-dashed border-slate-300 rounded text-center text-xs text-slate-400">
                  Form Component Integration Area
                </div>
              </div>

              {/* Role-Based Navigation & Access Module Placeholder (Itumeleng) */}
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 border-b pb-2 mb-3">
                  RBAC Controls & Views (Itumeleng)
                </h3>
                <p className="text-xs text-slate-500 mb-4">
                  Placeholder container for role-restricted navigation options (Physician, Nurse, Admin views).
                </p>
                <div className="p-4 border-2 border-dashed border-slate-300 rounded text-center text-xs text-slate-400">
                  Role-Based Action Panel Integration Area
                </div>
              </div>

            </div>
          </div>
        )}
      </main>

      <footer className="bg-slate-200 text-center py-3 text-xs text-slate-600 border-t border-slate-300">
        Camp Health Records System &copy; 2026 — Offline Encrypted Environment
      </footer>
    </div>
  );
}