import { useState } from 'react';
import { Search, LogOut, ShieldCheck, Pill, ClipboardList, AlertTriangle, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';
import { AllergyAlertBanner } from './AllergyAlertBanner';
import { ProtectedView } from './ProtectedView';
import RoleBadge from './RoleBadge';
import MedicationCheckIn from './MedicationCheckIn';
import MedShackVisitRecord from './MedShackVisitRecord';
import NearMissIncidentForm from './NearMissIncidentForm';
import StaffCheckIn from './StaffCheckIn';
import NewPatientProfile from './NewPatientProfile';
import AuditLogViewer from './AuditLogViewer';
import CsvImport from './CsvImport';
import UsbBackup from './UsbBackup';
import PendingUsersApproval from './PendingUsersApproval';

interface PatientRecord {
  id: string;
  name: string;
  dateOfBirth?: string;
  allergies: string[];
  diagnosis: string;
  medicalNotes?: string;
}

type ActiveForm = 'none' | 'medication' | 'medshack' | 'incident' | 'staff-checkin' | 'new-patient';

export default function MedicalDashboard() {
  const { user, logout } = useAuth();
  const [patientIdInput, setPatientIdInput] = useState('');
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeForm, setActiveForm] = useState<ActiveForm>('none');

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
      setActiveForm('none');
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
        <div className="h-1 bg-lime-400" />
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-ink">Medical Dashboard</h1>
            <p className="font-mono text-xs text-slate-500">
              {user?.username} &middot; <span className="text-footprints-600">Camp Footprints</span>
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
        {/* Search + New patient - hidden while a form is open */}
        {activeForm === 'none' && (
          <>
            <div className="mb-6 flex gap-2">
              <form onSubmit={handleSearch} className="flex flex-1 gap-2">
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
              <ProtectedView requiredPermission="EDIT_CLINICAL_RECORDS">
                <button
                  onClick={() => setActiveForm('new-patient')}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-clinical-600 hover:bg-clinical-50"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  New patient
                </button>
              </ProtectedView>
            </div>
            {error && <p className="mb-4 text-sm font-medium text-alert-600">{error}</p>}
          </>
        )}

        {/* Active clinical form takes over the main area */}
        {activeForm === 'medication' && patient && (
          <MedicationCheckIn
            patient={patient}
            onCancel={() => setActiveForm('none')}
            onSaved={() => setActiveForm('none')}
          />
        )}
        {activeForm === 'medshack' && patient && (
          <MedShackVisitRecord
            patient={patient}
            onCancel={() => setActiveForm('none')}
            onSaved={() => setActiveForm('none')}
          />
        )}
        {activeForm === 'incident' && (
          <NearMissIncidentForm
            initialPatientName={patient?.name}
            onCancel={() => setActiveForm('none')}
            onSaved={() => setActiveForm('none')}
          />
        )}
        {activeForm === 'staff-checkin' && (
          <StaffCheckIn
            onCancel={() => setActiveForm('none')}
            onSaved={() => setActiveForm('none')}
          />
        )}
        {activeForm === 'new-patient' && (
          <NewPatientProfile
            onCancel={() => setActiveForm('none')}
            onSaved={(id) => {
              setActiveForm('none');
              setPatientIdInput(id);
            }}
          />
        )}

        {/* Patient record + form launchers */}
        {activeForm === 'none' && patient && (
          <div className="space-y-4">
            <AllergyAlertBanner
              allergies={patient.allergies}
              diagnosis={patient.diagnosis}
              medicalNotes={patient.medicalNotes}
            />

            <div className="rounded border border-slate-100 bg-white p-5 shadow-card">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
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

              <ProtectedView
                requiredPermission="EDIT_CLINICAL_RECORDS"
                fallback={
                  <p className="text-sm text-slate-500">
                    Your role has view-only access to this patient's clinical forms.
                  </p>
                }
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => setActiveForm('medication')}
                    className="flex items-center gap-3 rounded border border-slate-200 p-4 text-left hover:border-clinical-500 hover:bg-clinical-50"
                  >
                    <Pill className="h-5 w-5 text-clinical-500" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-ink">Medication check-in</p>
                      <p className="text-xs text-slate-500">Digitised FR-03 assessment form</p>
                    </div>
                  </button>
                  <button
                    onClick={() => setActiveForm('medshack')}
                    className="flex items-center gap-3 rounded border border-slate-200 p-4 text-left hover:border-clinical-500 hover:bg-clinical-50"
                  >
                    <ClipboardList className="h-5 w-5 text-clinical-500" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-ink">MedShack visit</p>
                      <p className="text-xs text-slate-500">Digitised FR-04 visit record</p>
                    </div>
                  </button>
                </div>
              </ProtectedView>

              <ProtectedView requiredPermission="FILE_INCIDENT_REPORT">
                <button
                  onClick={() => setActiveForm('incident')}
                  className="mt-3 flex w-full items-center gap-3 rounded border border-amber-500 bg-amber-50 p-4 text-left hover:bg-amber-100"
                >
                  <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-amber-600">File a near-miss / incident report</p>
                    <p className="text-xs text-amber-600">Restricted &mdash; FR-05. Cannot be edited once filed.</p>
                  </div>
                </button>
              </ProtectedView>
            </div>
          </div>
        )}

        {activeForm === 'none' && !patient && (
          <div className="rounded border border-dashed border-slate-300 bg-white p-10 text-center">
            <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-slate-500" aria-hidden="true" />
            <p className="text-sm text-slate-500">
              Search for a patient to view their profile and clinical alerts.
            </p>
          </div>
        )}

        {/* Staff check-in and audit log - not tied to a loaded patient */}
        {activeForm === 'none' && (
          <div className="mt-6 space-y-6">
            <ProtectedView requiredPermission="EDIT_CLINICAL_RECORDS">
              <button
                onClick={() => setActiveForm('staff-checkin')}
                className="flex w-full items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left shadow-card hover:border-clinical-500 hover:bg-clinical-50"
              >
                <Users className="h-5 w-5 text-clinical-500" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-ink">Medical Centre check-in &mdash; staff and crew</p>
                  <p className="text-xs text-slate-500">FR-06. Stored separately from camper records.</p>
                </div>
              </button>
            </ProtectedView>

            <ProtectedView requiredPermission="VIEW_AUDIT_LOGS">
              <AuditLogViewer />
            </ProtectedView>

            <ProtectedView requiredPermission="IMPORT_CSV">
              <CsvImport />
            </ProtectedView>

            <ProtectedView requiredPermission="MANAGE_USERS">
              <PendingUsersApproval />
            </ProtectedView>

            <ProtectedView requiredPermission="MANAGE_BACKUP">
              <UsbBackup />
            </ProtectedView>
          </div>
        )}
      </main>
    </div>
  );
}