import { useState } from 'react';
import { Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

/**
 * FR-02 / Tech Spec Section "Data Backup, Import, and Retention":
 * CSV import of camper rosters. Expected columns per the tech spec:
 * FirstName, LastName, DateOfBirth (YYYY-MM-DD), PrimaryDiagnosis.
 *
 * OPEN ISSUE (OI-06 in the FSD): "CSV import format for camper intake
 * not formally specified (columns, types, encoding, validation rules)."
 * This is built against the ONE place in the docs that names actual
 * columns (tech spec System Feature 3), but that hasn't been confirmed
 * against a real Foundation-provided file. Expect to revisit the column
 * mapping once OI-06 is resolved.
 *
 * Parsing is done client-side with a minimal hand-rolled CSV reader
 * since no CSV library (e.g. papaparse) is in package.json yet — this
 * does not handle quoted fields containing commas. Fine for a simple
 * roster file; swap for papaparse if real-world files turn out messier.
 *
 * NOTE: apiService.request('patient:import-csv', ...) does NOT exist
 * in electron/main.js yet.
 */

interface ParsedRow {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  primaryDiagnosis: string;
  rowErrors: string[];
}

const EXPECTED_HEADERS = ['FirstName', 'LastName', 'DateOfBirth', 'PrimaryDiagnosis'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseCsv(text: string): { rows: ParsedRow[]; headerError?: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], headerError: 'The file is empty.' };

  const headers = lines[0].split(',').map((h) => h.trim());
  const missing = EXPECTED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return { rows: [], headerError: `Missing required column(s): ${missing.join(', ')}` };
  }

  const idx = {
    firstName: headers.indexOf('FirstName'),
    lastName: headers.indexOf('LastName'),
    dateOfBirth: headers.indexOf('DateOfBirth'),
    primaryDiagnosis: headers.indexOf('PrimaryDiagnosis'),
  };

  const rows: ParsedRow[] = lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row: ParsedRow = {
      firstName: cells[idx.firstName] ?? '',
      lastName: cells[idx.lastName] ?? '',
      dateOfBirth: cells[idx.dateOfBirth] ?? '',
      primaryDiagnosis: cells[idx.primaryDiagnosis] ?? '',
      rowErrors: [],
    };
    if (!row.firstName) row.rowErrors.push('Missing FirstName');
    if (!row.lastName) row.rowErrors.push('Missing LastName');
    if (!DATE_PATTERN.test(row.dateOfBirth)) row.rowErrors.push('DateOfBirth must be YYYY-MM-DD');
    return row;
  });

  return { rows };
}

export default function CsvImport() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState('');
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleFile = async (file: File) => {
    setImportResult(null);
    setFileName(file.name);
    const text = await file.text();
    const { rows: parsed, headerError: err } = parseCsv(text);
    setRows(parsed);
    setHeaderError(err ?? '');
  };

  const validRowCount = rows.filter((r) => r.rowErrors.length === 0).length;
  const invalidRowCount = rows.length - validRowCount;

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await apiService.request<{ imported: number; duplicates: number }>('patient:import-csv', {
        rows: rows.filter((r) => r.rowErrors.length === 0),
        importedByUserId: user?.userId,
      });
      await apiService.request('audit:log-event', {
        userId: user?.userId,
        action: 'PATIENT_CSV_IMPORTED',
      });
      setImportResult({
        success: true,
        message: `Imported ${result?.imported ?? validRowCount} record(s).${
          result?.duplicates ? ` ${result.duplicates} duplicate(s) skipped.` : ''
        }`,
      });
    } catch {
      setImportResult({ success: false, message: "Import failed — the backend handler for this isn't built yet." });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded border border-slate-100 bg-white shadow-card">
      <header className="border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">Import camper roster (CSV)</h3>
        <p className="text-xs text-slate-500">Columns required: FirstName, LastName, DateOfBirth (YYYY-MM-DD), PrimaryDiagnosis</p>
      </header>

      <div className="p-5">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded border-2 border-dashed border-slate-300 p-6 text-sm text-slate-500 hover:border-clinical-500 hover:bg-clinical-50">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {fileName || 'Click to choose a .csv file'}
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>

        {headerError && (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-alert-600">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {headerError}
          </p>
        )}

        {rows.length > 0 && !headerError && (
          <div className="mt-4">
            <p className="mb-2 text-sm text-slate-700">
              <span className="font-semibold text-confirm-600">{validRowCount} valid</span>
              {invalidRowCount > 0 && (
                <span className="text-alert-600"> &middot; {invalidRowCount} with errors (will be skipped)</span>
              )}
            </p>

            <div className="max-h-48 overflow-y-auto rounded border border-slate-100">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5">Name</th>
                    <th className="px-3 py-1.5">DOB</th>
                    <th className="px-3 py-1.5">Diagnosis</th>
                    <th className="px-3 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{row.firstName} {row.lastName}</td>
                      <td className="px-3 py-1.5 font-mono">{row.dateOfBirth}</td>
                      <td className="px-3 py-1.5">{row.primaryDiagnosis}</td>
                      <td className="px-3 py-1.5">
                        {row.rowErrors.length === 0 ? (
                          <span className="text-confirm-600">Valid</span>
                        ) : (
                          <span className="text-alert-600">{row.rowErrors.join('; ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={handleImport}
              disabled={importing || validRowCount === 0}
              className="mt-3 rounded bg-clinical-500 px-4 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50"
            >
              {importing ? 'Importing…' : `Import ${validRowCount} record(s)`}
            </button>
          </div>
        )}

        {importResult && (
          <p className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${importResult.success ? 'text-confirm-600' : 'text-alert-600'}`}>
            {importResult.success ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
            {importResult.message}
          </p>
        )}
      </div>
    </div>
  );
}