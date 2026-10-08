import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, WifiOff, TriangleAlert } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { downloadDrivePhotoThumbnails } from '../utils/drivePhotos';

/**
 * Pulls camper registrations submitted through the Google Form from the
 * linked Google Sheet into the local database.
 *
 * This is the only feature that needs the internet, and only while the
 * button is being pressed. Everything else in CHRS reads and writes the local
 * database, so losing connectivity never stops clinical work; a failed sync
 * simply leaves the local data exactly as it was.
 *
 * Photos: a parent can upload a photo in the Form. The sheet then holds a
 * Google Drive link. Before importing, this card downloads those photos (only
 * for children about to be added), shrinks them, and imports them with the
 * child. If the photos can't be downloaded, nothing is imported until staff
 * choose to carry on without them, because a photo can't be attached by a
 * later sync once the child is in CHRS (the physician can still add one by hand).
 */

interface SyncStatus {
  success: boolean;
  configured?: boolean;
  sheetName?: string | null;
  configProblem?: string | null;
  lastSync?: { eventTime: string; rowsRead: number; imported: number } | null;
  lastAttempt?: { eventTime: string; status: 'success' | 'failed'; errorMessage: string | null } | null;
}

interface SyncResult {
  success: boolean;
  error?: string;
  code?: string;
  rowsRead?: number;
  imported?: number;
  alreadySynced?: number;
  matchedExisting?: number;
  changedInSheet?: number[];
  invalid?: { rowNumber: number; reasons: string[] }[];
  ignoredColumns?: string[];
  photosAdded?: number;
  photoWarnings?: { rowNumber: number; message: string }[];
  drivePhotoIds?: string[];
}

const SESSION_DATE_STORAGE_KEY = 'chrs.sheetSync.campSessionDate';

function getLocalDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// The session date decides which camp a synced child belongs to, so it is
// remembered between launches rather than silently resetting to "today".
function loadRememberedSessionDate(): string {
  try {
    return window.localStorage.getItem(SESSION_DATE_STORAGE_KEY) || getLocalDate();
  } catch {
    return getLocalDate();
  }
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? iso : date.toLocaleString();
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export default function SheetSync() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [campSessionDate, setCampSessionDate] = useState(loadRememberedSessionDate);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await apiService.request<SyncStatus>('sheet:status'));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [refreshStatus]);

  const handleSessionDateChange = (value: string) => {
    setCampSessionDate(value);
    try {
      window.localStorage.setItem(SESSION_DATE_STORAGE_KEY, value);
    } catch {
      // Not remembering the date is harmless.
    }
  };

  const handleSync = async ({ withPhotos = true }: { withPhotos?: boolean } = {}) => {
    setSyncing(true);
    setResult(null);
    setPhotoProblem(null);
    try {
      let photoFiles: Record<string, string> = {};

      if (withPhotos) {
        setProgress('Checking the sheet…');
        const preview = await apiService.request<SyncResult>('sheet:preview', { campSessionDate });
        if (!preview?.success) {
          setResult({ success: false, error: preview?.error || 'The sync could not be completed.', code: preview?.code });
          return;
        }

        const ids = preview.drivePhotoIds ?? [];
        if (ids.length > 0) {
          setProgress(`Downloading photos… 0 of ${ids.length}`);
          const downloaded = await downloadDrivePhotoThumbnails(ids, (done, total) => setProgress(`Downloading photos… ${done} of ${total}`));
          const downloadedCount = Object.keys(downloaded.files).length;
          const firstFailure = Object.values(downloaded.failed)[0];

          if (downloaded.fatal || (downloadedCount === 0 && firstFailure)) {
            // Stop before anything is saved: importing now would leave these children without photos.
            setPhotoProblem(downloaded.fatal?.message || firstFailure);
            return;
          }
          photoFiles = downloaded.files;
        }
      }

      setProgress('Importing…');
      const response = await apiService.request<SyncResult>('sheet:sync', {
        importedByUserId: user?.userId,
        campSessionDate,
        photoFiles,
      });
      setResult(response?.success ? response : { success: false, error: response?.error || 'The sync could not be completed.', code: response?.code });
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : 'The sync could not be completed.' });
    } finally {
      setSyncing(false);
      setProgress('');
      refreshStatus();
    }
  };

  const notConfigured = status?.configured === false;
  const changedRows = result?.changedInSheet ?? [];
  const invalidRows = result?.invalid ?? [];
  const ignoredColumns = result?.ignoredColumns ?? [];

  return (
    <div className="rounded border border-slate-100 bg-white shadow-card">
      <header className="border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">Sync registrations from Google Sheet</h3>
        <p className="text-xs text-slate-500">
          Brings in children registered through the online Google Form. Already-synced children are never duplicated.
        </p>
      </header>

      <div className="p-5">
        {notConfigured && (
          <p className="mb-3 flex items-start gap-1.5 rounded bg-amber-50 p-3 text-sm text-amber-600">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Google Sheet sync hasn&apos;t been set up on this laptop yet. See the &ldquo;Set up a laptop&rdquo; section of docs/GOOGLE_SHEET_SYNC.md.
          </p>
        )}
        {status?.configProblem && (
          <p className="mb-3 flex items-start gap-1.5 rounded bg-alert-50 p-3 text-sm text-alert-600">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {status.configProblem}
          </p>
        )}
        {!online && (
          <p className="mb-3 flex items-start gap-1.5 rounded bg-slate-100 p-3 text-sm text-slate-700">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            This laptop looks offline. Syncing needs internet; everything else in CHRS keeps working.
          </p>
        )}

        <label className="mb-3 block text-xs font-medium text-slate-600">
          Camp session date for new children
          <input
            type="date"
            value={campSessionDate}
            onChange={(e) => handleSessionDateChange(e.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-2 text-sm text-ink"
            required
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleSync()}
            disabled={syncing || !campSessionDate || notConfigured}
            className="flex items-center gap-2 rounded bg-clinical-500 px-4 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {syncing ? progress || 'Syncing…' : 'Sync now'}
          </button>
          <p className="text-xs text-slate-500">
            {status?.lastSync ? `Last successful sync: ${formatWhen(status.lastSync.eventTime)}` : 'Not synced yet on this laptop.'}
          </p>
        </div>

        {photoProblem && (
          <div className="mt-3 space-y-2 rounded bg-amber-50 p-3 text-xs text-amber-600" role="alert">
            <p className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-semibold">The children&apos;s photos could not be downloaded, so nothing was imported yet.</span>{' '}
                {photoProblem}
              </span>
            </p>
            <p>
              Fix that and press Sync now again. Or import the children without photos now; the physician can then add each photo from the child&apos;s record.
            </p>
            <button
              type="button"
              onClick={() => handleSync({ withPhotos: false })}
              disabled={syncing}
              className="rounded border border-amber-600 bg-white px-3 py-1.5 font-semibold text-amber-600 hover:bg-amber-100 disabled:opacity-50"
            >
              Import without photos
            </button>
          </div>
        )}

        {result && !result.success && (
          <p className="mt-3 flex items-start gap-1.5 text-sm font-medium text-alert-600" role="alert">
            {result.code === 'OFFLINE' ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            {result.error}
          </p>
        )}

        {result?.success && (
          <div className="mt-3 space-y-2 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-confirm-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {result.imported
                ? `${result.imported} new ${result.imported === 1 ? 'child' : 'children'} added${result.photosAdded ? `, ${result.photosAdded} with ${result.photosAdded === 1 ? 'a photo' : 'photos'}` : ''}.`
                : 'Up to date. No new registrations.'}
            </p>
            <p className="text-xs text-slate-500">
              {plural(result.rowsRead ?? 0, 'response')} in the sheet
              {result.alreadySynced ? ` · ${result.alreadySynced} already synced earlier` : ''}
              {result.matchedExisting ? ` · ${result.matchedExisting} already in CHRS (not duplicated)` : ''}
            </p>

            {(result.photoWarnings?.length ?? 0) > 0 && (
              <div className="rounded bg-amber-50 p-3 text-xs text-amber-600">
                <p className="font-semibold">
                  {result.photoWarnings?.length === 1 ? '1 child was' : `${result.photoWarnings?.length} children were`} added without a photo. The physician can add {result.photoWarnings?.length === 1 ? 'it' : 'them'} from the child&apos;s record:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {(result.photoWarnings ?? []).map((warning) => (
                    <li key={warning.rowNumber}>Sheet row {warning.rowNumber}: {warning.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {invalidRows.length > 0 && (
              <div className="rounded bg-alert-50 p-3 text-xs text-alert-600">
                <p className="font-semibold">
                  {plural(invalidRows.length, 'response')} could not be imported. Fix {invalidRows.length === 1 ? 'it' : 'them'} in the sheet and sync again:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {invalidRows.map((row) => (
                    <li key={row.rowNumber}>Sheet row {row.rowNumber}: {row.reasons.join('; ')}</li>
                  ))}
                </ul>
              </div>
            )}

            {changedRows.length > 0 && (
              <p className="rounded bg-amber-50 p-3 text-xs text-amber-600">
                <span className="font-semibold">
                  Sheet row{changedRows.length === 1 ? '' : 's'} {changedRows.join(', ')} changed after {changedRows.length === 1 ? 'it was' : 'they were'} imported.
                </span>{' '}
                CHRS does not overwrite existing records, so please check the child&apos;s profile (especially allergies and medication) against the sheet.
              </p>
            )}

            {ignoredColumns.length > 0 && (
              <p className="rounded bg-amber-50 p-3 text-xs text-amber-600">
                <span className="font-semibold">Not imported (column not recognised):</span> {ignoredColumns.join(', ')}. If one of these should be imported, check its spelling against the setup guide.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
