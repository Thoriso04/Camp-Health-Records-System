import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Images, CheckCircle2, AlertCircle, TriangleAlert, FolderOpen, CloudDownload } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { prepareThumbnails, type PreparedPhotos } from '../utils/photoThumbnails';
import { downloadDrivePhotoThumbnails, type DrivePhotoResult } from '../utils/drivePhotos';

/**
 * Offline way to bring in registrations: download the Google Form's response
 * sheet as a CSV (Sheet > File > Download > Comma-separated values), then
 * choose it here. No internet and no Google setup are needed on this laptop.
 *
 * Uses exactly the same pipeline as "Sync now" (same column matching, same
 * duplicate protection), so a child can't be added twice whichever route
 * they arrive by. The preview below is read-only; nothing is saved until
 * "Import" is pressed.
 *
 * Photos come in two ways, and both end up in the same "Photo" column:
 *  - Parents upload one through the Google Form. The sheet then holds a Google
 *    Drive link, and "Download photos from Google Drive" fetches them (this one
 *    step needs internet and Google sync set up on this laptop).
 *  - Staff type a file name into the column; choose the photo files (or the
 *    folder they are in) and they are matched by name. Works fully offline.
 * A child with no photo, or whose photo can't be found, is imported with a
 * blank photo; the physician can add one later from the child's record.
 */

type Outcome = 'import' | 'invalid' | 'already_synced' | 'matched_existing';

interface PreviewRow {
  rowNumber: number;
  name: string;
  dateOfBirth: string;
  outcome: Outcome;
  reasons: string[];
  changedInSource: boolean;
  photo: { status: string; message: string } | null;
}

interface Summary {
  success: boolean;
  error?: string;
  code?: string;
  rowsRead?: number;
  imported?: number;
  alreadySynced?: number;
  matchedExisting?: number;
  photosAdded?: number;
  photoWarnings?: { rowNumber: number; message: string }[];
  changedInSheet?: number[];
  invalid?: { rowNumber: number; reasons: string[] }[];
  ignoredColumns?: string[];
  photoColumnFound?: boolean;
  drivePhotoIds?: string[];
  rows?: PreviewRow[];
}

// Shared with the Google sync card so both remember the same camp session.
const SESSION_DATE_STORAGE_KEY = 'chrs.sheetSync.campSessionDate';

function getLocalDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function loadRememberedSessionDate(): string {
  try {
    return window.localStorage.getItem(SESSION_DATE_STORAGE_KEY) || getLocalDate();
  } catch {
    return getLocalDate();
  }
}

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

const OUTCOME_LABEL: Record<Outcome, string> = {
  import: 'Will be added',
  invalid: 'Cannot import',
  already_synced: 'Already imported earlier',
  matched_existing: 'Already in CHRS (skipped)',
};

function photoLabel(row: PreviewRow): { text: string; tone: 'ok' | 'warn' | 'none' } {
  if (row.outcome !== 'import' || !row.photo) return { text: '—', tone: 'none' };
  if (row.photo.status === 'none') return { text: 'No photo', tone: 'none' };
  if (['matched', 'embedded', 'drive'].includes(row.photo.status)) return { text: 'Photo found', tone: 'ok' };
  if (row.photo.status === 'drive_pending') return { text: 'On Google Drive, not downloaded yet', tone: 'warn' };
  return { text: row.photo.message, tone: 'warn' };
}

export default function RegistrationCsvImport() {
  const { user } = useAuth();
  const [csv, setCsv] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [photos, setPhotos] = useState<PreparedPhotos>({ files: {}, unreadable: [], duplicates: [] });
  const [photoProgress, setPhotoProgress] = useState<string>('');
  const [drivePhotos, setDrivePhotos] = useState<DrivePhotoResult>({ files: {}, failed: {} });
  const [driveProgress, setDriveProgress] = useState<string>('');
  const [campSessionDate, setCampSessionDate] = useState(loadRememberedSessionDate);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const requestId = useRef(0);

  // Photos chosen from disk plus photos downloaded from Google Drive. Drive
  // photos are keyed "drive:<id>", so the two can never be confused.
  const photoFiles = useMemo(() => ({ ...photos.files, ...drivePhotos.files }), [photos.files, drivePhotos.files]);
  const photoCount = Object.keys(photos.files).length;
  const drivePhotoCount = Object.keys(drivePhotos.files).length;

  // Re-run the read-only preview whenever the file, the photos or the date change.
  useEffect(() => {
    if (!csv) {
      setPreview(null);
      return;
    }
    const thisRequest = ++requestId.current;
    setPreviewing(true);
    apiService
      .request<Summary>('registration:csv-preview', { csvBytes: csv.bytes, fileName: csv.name, campSessionDate, photoFiles })
      .then((summary) => {
        if (thisRequest === requestId.current) setPreview(summary);
      })
      .catch((error) => {
        if (thisRequest === requestId.current) setPreview({ success: false, error: error instanceof Error ? error.message : 'The file could not be checked.' });
      })
      .finally(() => {
        if (thisRequest === requestId.current) setPreviewing(false);
      });
  }, [csv, photoFiles, campSessionDate]);

  const handleCsv = async (file: File) => {
    setResult(null);
    setDrivePhotos({ files: {}, failed: {} });
    try {
      setCsv({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch {
      setCsv(null);
      setPreview({ success: false, error: 'Could not read this file. Download it again from Google Sheets and try again.' });
    }
  };

  const handlePhotos = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setResult(null);
    setPhotoProgress('Preparing photos…');
    try {
      const prepared = await prepareThumbnails(Array.from(fileList), (done, total) => setPhotoProgress(`Preparing photos… ${done} of ${total}`));
      setPhotos(prepared);
    } finally {
      setPhotoProgress('');
    }
  };

  const handleDrivePhotos = async () => {
    const ids = preview?.drivePhotoIds ?? [];
    if (ids.length === 0) return;
    setResult(null);
    setDriveProgress(`Downloading photos… 0 of ${ids.length}`);
    try {
      const downloaded = await downloadDrivePhotoThumbnails(ids, (done, total) => setDriveProgress(`Downloading photos… ${done} of ${total}`));
      setDrivePhotos((current) => ({
        files: { ...current.files, ...downloaded.files },
        failed: downloaded.failed,
        fatal: downloaded.fatal,
      }));
    } finally {
      setDriveProgress('');
    }
  };

  const handleSessionDateChange = (value: string) => {
    setCampSessionDate(value);
    setResult(null);
    try {
      if (value) window.localStorage.setItem(SESSION_DATE_STORAGE_KEY, value);
    } catch {
      /* remembering the date is a convenience only */
    }
  };

  const handleImport = async () => {
    if (!csv) return;
    setImporting(true);
    try {
      const outcome = await apiService.request<Summary>('registration:csv-import', {
        csvBytes: csv.bytes,
        fileName: csv.name,
        campSessionDate,
        photoFiles,
        importedByUserId: user?.userId,
      });
      setResult(outcome);
      if (outcome?.success) setCsv(null); // the file is done with; a re-import would add nothing anyway
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : 'The import could not be completed.' });
    } finally {
      setImporting(false);
    }
  };

  const toAdd = preview?.success ? preview.imported ?? 0 : 0;
  const photoWarnings = preview?.photoWarnings ?? [];
  const showPhotoColumnHint = preview?.success && photoCount > 0 && preview.photoColumnFound === false;
  const drivePending = preview?.success ? preview.drivePhotoIds ?? [] : [];
  const driveFailures = Object.keys(drivePhotos.failed).length;

  return (
    <div className="rounded border border-slate-100 bg-white shadow-card">
      <header className="border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">Import registrations from a downloaded file (offline)</h3>
        <p className="text-xs text-slate-500">
          Use this when there is no internet. Download the response sheet from Google Sheets as a CSV and choose it here. Children already in CHRS are never added twice.
        </p>
      </header>

      <div className="space-y-4 p-5">
        <label className="block text-xs font-medium text-slate-600">
          Camp session date for new children
          <input
            type="date"
            value={campSessionDate}
            onChange={(e) => handleSessionDateChange(e.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-2 text-sm text-ink"
            required
          />
        </label>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded border-2 border-dashed border-slate-300 p-5 text-sm text-slate-500 hover:border-clinical-500 hover:bg-clinical-50">
          <FileUp className="h-4 w-4" aria-hidden="true" />
          {csv?.name || '1. Choose the registration CSV file'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCsv(file);
              e.target.value = ''; // lets the same file be chosen again after a fix
            }}
          />
        </label>

        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-600">2. Photos (optional)</p>
          <div className="flex flex-wrap gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-clinical-500 hover:bg-clinical-50">
              <Images className="h-4 w-4" aria-hidden="true" />
              Choose photo files
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handlePhotos(e.target.files); e.target.value = ''; }} />
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-clinical-500 hover:bg-clinical-50">
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              Choose a photo folder
              {/* webkitdirectory is a Chromium (Electron) attribute that React does not type */}
              <input
                type="file"
                multiple
                className="hidden"
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(e) => { handlePhotos(e.target.files); e.target.value = ''; }}
              />
            </label>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {photoProgress || (photoCount > 0 ? `${plural(photoCount, 'photo')} ready.` : 'Only needed if the sheet\u2019s photo column holds file names (rather than Google Drive links).')}
          </p>
          {photos.unreadable.length > 0 && (
            <p className="mt-1.5 rounded bg-amber-50 p-2 text-xs text-amber-600">
              Could not open: {photos.unreadable.join(', ')}. Save these as JPG or PNG (iPhone HEIC photos are not supported) and choose them again.
            </p>
          )}
          {photos.duplicates.length > 0 && (
            <p className="mt-1.5 rounded bg-amber-50 p-2 text-xs text-amber-600">
              These file names appear more than once, so they were skipped to avoid the wrong child&apos;s photo: {photos.duplicates.join(', ')}.
            </p>
          )}
        </div>

        {(drivePending.length > 0 || driveProgress || drivePhotoCount > 0 || drivePhotos.fatal) && (
          <div className="rounded border border-slate-200 p-3">
            <p className="mb-1.5 text-xs font-medium text-slate-600">Photos uploaded through the Google Form</p>
            {drivePending.length > 0 && !driveProgress && (
              <button
                type="button"
                onClick={handleDrivePhotos}
                className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-clinical-500 hover:bg-clinical-50"
              >
                <CloudDownload className="h-4 w-4" aria-hidden="true" />
                Download {plural(drivePending.length, 'photo')} from Google Drive
              </button>
            )}
            <p className="mt-1.5 text-xs text-slate-500">
              {driveProgress
                || (drivePending.length > 0
                  ? 'Needs internet and Google sync set up on this laptop. Skip this to import the children without these photos; the physician can add them later.'
                  : drivePhotoCount > 0 ? `${plural(drivePhotoCount, 'photo')} downloaded.` : '')}
            </p>
            {drivePhotos.fatal && (
              <p className="mt-1.5 flex items-start gap-1.5 rounded bg-amber-50 p-2 text-xs text-amber-600" role="alert">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {drivePhotos.fatal.message}
              </p>
            )}
            {!drivePhotos.fatal && driveFailures > 0 && (
              <p className="mt-1.5 rounded bg-amber-50 p-2 text-xs text-amber-600">
                {plural(driveFailures, 'photo')} could not be downloaded: {[...new Set(Object.values(drivePhotos.failed))].join(' ')}
              </p>
            )}
          </div>
        )}

        {previewing && !preview && <p className="text-xs text-slate-500">Checking the file…</p>}

        {preview && !preview.success && (
          <p className="flex items-start gap-1.5 text-sm font-medium text-alert-600" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {preview.error}
          </p>
        )}

        {preview?.success && csv && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-confirm-600">{toAdd} will be added</span>
              {(preview.alreadySynced ?? 0) + (preview.matchedExisting ?? 0) > 0 && (
                <span className="text-slate-500"> · {(preview.alreadySynced ?? 0) + (preview.matchedExisting ?? 0)} already in CHRS</span>
              )}
              {(preview.invalid?.length ?? 0) > 0 && (
                <span className="text-alert-600"> · {plural(preview.invalid?.length ?? 0, 'row')} cannot be imported</span>
              )}
            </p>

            <div className="max-h-64 overflow-auto rounded border border-slate-100">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5">Row</th>
                    <th className="px-3 py-1.5">Name</th>
                    <th className="px-3 py-1.5">Date of birth</th>
                    <th className="px-3 py-1.5">Photo</th>
                    <th className="px-3 py-1.5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.rows ?? []).map((row) => {
                    const photo = photoLabel(row);
                    return (
                      <tr key={row.rowNumber} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-1.5 font-mono">{row.rowNumber}</td>
                        <td className="px-3 py-1.5">{row.name}</td>
                        <td className="px-3 py-1.5 font-mono">{row.dateOfBirth || '—'}</td>
                        <td className={`px-3 py-1.5 ${photo.tone === 'warn' ? 'text-amber-600' : photo.tone === 'ok' ? 'text-confirm-600' : 'text-slate-400'}`}>{photo.text}</td>
                        <td className={`px-3 py-1.5 ${row.outcome === 'invalid' ? 'text-alert-600' : row.outcome === 'import' ? 'text-confirm-600' : 'text-slate-500'}`}>
                          {row.outcome === 'invalid' ? row.reasons.join('; ') : OUTCOME_LABEL[row.outcome]}
                          {row.changedInSource && <span className="block text-amber-600">Edited since it was imported (CHRS keeps the saved version)</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {showPhotoColumnHint && (
              <p className="flex items-start gap-1.5 rounded bg-amber-50 p-3 text-xs text-amber-600">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                You chose photos, but this file has no column called &ldquo;Photo&rdquo;, so none will be attached. Add a column headed Photo to the sheet containing each child&apos;s photo file name, then download it again.
              </p>
            )}

            {photoWarnings.length > 0 && (
              <p className="flex items-start gap-1.5 rounded bg-amber-50 p-3 text-xs text-amber-600">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{plural(photoWarnings.length, 'child', 'children')} will be added without a photo.</span>{' '}
                  Importing again will not add a photo to a child who is already in CHRS, so if you want these, fix the file names, choose the missing photos or download them from Google Drive now (the preview updates by itself). Otherwise the physician can add a photo from the child&apos;s record.
                </span>
              </p>
            )}

            {(preview.ignoredColumns?.length ?? 0) > 0 && (
              <p className="rounded bg-amber-50 p-3 text-xs text-amber-600">
                <span className="font-semibold">Not imported (column not recognised):</span> {preview.ignoredColumns?.join(', ')}
              </p>
            )}

            <button
              onClick={handleImport}
              disabled={importing || previewing || toAdd === 0 || !campSessionDate}
              className="rounded bg-clinical-500 px-4 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
            >
              {importing ? 'Importing…' : toAdd === 0 ? 'Nothing new to import' : `Import ${plural(toAdd, 'child', 'children')}`}
            </button>
          </div>
        )}

        {result && !result.success && (
          <p className="flex items-start gap-1.5 text-sm font-medium text-alert-600" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {result.error}
          </p>
        )}

        {result?.success && (
          <p className="flex items-start gap-1.5 text-sm font-medium text-confirm-600">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {plural(result.imported ?? 0, 'child', 'children')} added
            {(result.photosAdded ?? 0) > 0 ? `, ${plural(result.photosAdded ?? 0, 'with a photo', 'with photos')}` : ''}.
            {(result.alreadySynced ?? 0) + (result.matchedExisting ?? 0) > 0
              ? ` ${(result.alreadySynced ?? 0) + (result.matchedExisting ?? 0)} were already in CHRS and not duplicated.`
              : ''}
          </p>
        )}
      </div>
    </div>
  );
}
