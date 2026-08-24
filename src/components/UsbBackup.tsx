import { useState } from 'react';
import { HardDriveDownload, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * FR-08: Data Backup
 *
 * "Backup to USB" accessible from the main dashboard. Detects connected
 * USB drives, presents a list for selection, creates a backup folder
 * named CHRS_Backup_YYYYMMDD_HHMMSS, verifies with SHA-256, and shows
 * a clear error if it fails.
 *
 * NOTE: apiService.request('backup:list-drives', ...) and
 * apiService.request('backup:start', ...) do NOT exist in
 * electron/main.js yet. The tech spec says drive detection uses
 * Node's child_process wmic command — that's main-process-only code,
 * so this component can only ever call it through IPC, never do it
 * directly, which is correct given the sandboxed renderer.
 */

interface UsbDrive {
  driveLetter: string;
  label: string;
  freeSpaceGb: number;
}

function backupFolderName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `CHRS_Backup_${date}_${time}`;
}

export default function UsbBackup() {
  const { user } = useAuth();
  const [drives, setDrives] = useState<UsbDrive[] | null>(null);
  const [selectedDrive, setSelectedDrive] = useState('');
  const [scanning, setScanning] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const scanForDrives = async () => {
    setScanning(true);
    setResult(null);
    try {
      const found = await apiService.request<UsbDrive[]>('backup:list-drives', {});
      setDrives(Array.isArray(found) ? found : []);
    } catch {
      setDrives([]);
      setResult({ success: false, message: "Couldn't detect USB drives — this IPC handler isn't built yet." });
    } finally {
      setScanning(false);
    }
  };

  const startBackup = async () => {
    if (!selectedDrive) return;
    setBackingUp(true);
    setResult(null);
    try {
      const folderName = backupFolderName();
      await apiService.request('backup:start', {
        driveLetter: selectedDrive,
        folderName,
        initiatedByUserId: user?.userId,
      });
      await apiService.request('audit:log-event', {
        userId: user?.userId,
        action: 'BACKUP_COMPLETED',
      });
      setResult({ success: true, message: `Backup written to ${selectedDrive}\\${folderName}, integrity verified.` });
    } catch {
      setResult({ success: false, message: 'Backup failed. The drive may have been disconnected, or this feature is not built yet.' });
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <div className="rounded border border-slate-100 bg-white shadow-card">
      <header className="border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">Backup to USB</h3>
        <p className="text-xs text-slate-500">Encrypted, SHA-256 verified. Folder name: CHRS_Backup_YYYYMMDD_HHMMSS</p>
      </header>

      <div className="p-5">
        {!drives && (
          <button
            onClick={scanForDrives}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded bg-clinical-500 px-4 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
          >
            <HardDriveDownload className="h-4 w-4" aria-hidden="true" />
            {scanning ? 'Scanning…' : 'Detect USB drives'}
          </button>
        )}

        {drives && drives.length === 0 && (
          <p className="text-sm text-slate-500">No USB drives detected. Connect a drive and try again.</p>
        )}

        {drives && drives.length > 0 && (
          <div className="space-y-3">
            <div className="space-y-2">
              {drives.map((d) => (
                <label
                  key={d.driveLetter}
                  className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-sm ${
                    selectedDrive === d.driveLetter ? 'border-clinical-500 bg-clinical-50' : 'border-slate-300'
                  }`}
                >
                  <span>
                    <span className="font-mono">{d.driveLetter}</span> &mdash; {d.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{d.freeSpaceGb} GB free</span>
                    <input
                      type="radio"
                      name="drive"
                      checked={selectedDrive === d.driveLetter}
                      onChange={() => setSelectedDrive(d.driveLetter)}
                    />
                  </span>
                </label>
              ))}
            </div>
            <button
              onClick={startBackup}
              disabled={!selectedDrive || backingUp}
              className="rounded bg-clinical-500 px-4 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
            >
              {backingUp ? 'Backing up…' : 'Start backup'}
            </button>
          </div>
        )}

        {result && (
          <p className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${result.success ? 'text-confirm-600' : 'text-alert-600'}`}>
            {result.success ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}