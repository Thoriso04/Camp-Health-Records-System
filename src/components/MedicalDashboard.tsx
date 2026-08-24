import { useState } from 'react';
import { Search, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';
import { AllergyAlertBanner } from './AllergyAlertBanner';
import { ProtectedView } from './ProtectedView';
import RoleBadge from './RoleBadge';

interface PatientRecord {
  id: string;
  name: string;
  allergies: string[];
  diagnosis: string;
  medicalNotes?: string;
}

export default function MedicalDashboard() {
  const { user, logout } = useAuth();
  const [patientIdInput, setPatientIdInput] = useState('');
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientIdInput.trim()) {
      setError('Enter a patient ID or search term first.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await apiService.request<PatientRecord>('patient:get-by-id', patientIdInput.trim());
      setPatient(result);
      await apiService.request('audit:log-event', {
        userId: user?.userId,
        action: 'PATIENT_RECORD_VIEWED',
      });
    } catch {
      setError("Couldn't load that patient record. Check the ID and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      {/* Top bar */}
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-ink">Medical Dashboard</h1>
            <p className="font-mono text-xs text-slate-500">
              {user?.username} &middot; Camp Footprints
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RoleBadge role={user?.role} />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-500" aria-hidden="true" />
              Offline mode
            </span>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Search */}
        <form onSubmit={handleSearch} className="mb-6 flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              type="text"
              value={patientIdInput}
              onChange={(e) => setPatientIdInput(e.target.value)}
              placeholder="Search by patient ID (e.g. CAMPER-001)"
              aria-label="Search for a patient by ID"
              className="w-full rounded border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-slate-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-clinical-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
        {error && <p className="mb-4 text-sm font-medium text-alert-600">{error}</p>}

        {/* Patient record */}
        {patient ? (
          <div className="space-y-4">
            <AllergyAlertBanner
              allergies={patient.allergies}
              diagnosis={patient.diagnosis}
              medicalNotes={patient.medicalNotes}
            />

            <div className="rounded border border-slate-100 bg-white p-5 shadow-card">
              <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink">{patient.name}</h2>
                  <p className="font-mono text-xs text-slate-500">{patient.id}</p>
                </div>
                <ProtectedView requiredPermission="EDIT_CLINICAL_RECORDS">
                  <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-clinical-600 hover:bg-clinical-50">
                    Edit record
                  </button>
                </ProtectedView>
              </div>
              <p className="text-sm text-slate-700">
                Full clinical form views (Medication Check-In, MedShack Visit, etc.) go here next.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded border border-dashed border-slate-300 bg-white p-10 text-center">
            <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-slate-500" aria-hidden="true" />
            <p className="text-sm text-slate-500">
              Search for a patient to view their profile and clinical alerts.
            </p>
          </div>
        )}

        {/* Role-gated admin section */}
        <ProtectedView requiredPermission="VIEW_AUDIT_LOGS">
          <div className="mt-6 rounded border border-slate-100 bg-white p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink">Audit log</h3>
            <p className="mt-1 text-xs text-slate-500">
              Full audit log viewer goes here (FR-09).
            </p>
          </div>
        </ProtectedView>
      </main>
    </div>
  );
}