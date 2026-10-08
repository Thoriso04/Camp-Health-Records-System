import { useState } from 'react';
import { Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface ParsedRow {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  primaryDiagnosis: string;
  rowErrors: string[];
}

const EXPECTED_HEADERS = ['FirstName', 'LastName', 'DateOfBirth', 'PrimaryDiagnosis'];

function parseCsv(text: string): { rows: ParsedRow[]; headerError?: string } {
  if (!text.trim()) return { rows: [], headerError: 'The file is empty.' };

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim().toLowerCase(),
  });
  const headers = result.meta.fields ?? [];
  const missing = EXPECTED_HEADERS.filter((header) => !headers.includes(header.toLowerCase()));

  if (missing.length > 0) {
    return { rows: [], headerError: `Missing required column(s): ${missing.join(', ')}` };
  }

  const rows = result.data.map((record) => {
    const row: ParsedRow = {
      firstName: record.firstname?.trim() ?? '',
      lastName: record.lastname?.trim() ?? '',
      dateOfBirth: record.dateofbirth?.trim() ?? '',
      primaryDiagnosis: record.primarydiagnosis?.trim() ?? '',
      rowErrors: [],
    };
    const date = new Date(`${row.dateOfBirth}T00:00:00.000Z`);

    if (!row.firstName) row.rowErrors.push('Missing FirstName');
    if (!row.lastName) row.rowErrors.push('Missing LastName');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== row.dateOfBirth) {
      row.rowErrors.push('DateOfBirth must be a valid YYYY-MM-DD date');
    }
    if (!row.primaryDiagnosis) row.rowErrors.push('Missing PrimaryDiagnosis');
    return row;
  });

  return { rows };
}

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
 */
function getLocalDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function readCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let encoding = 'utf-8';

  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';

  return new TextDecoder(encoding).decode(buffer);
}

export default function CsvImport() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ReturnType<typeof parseCsv>['rows']>([]);
  const [headerError, setHeaderError] = useState('');
  const [fileName, setFileName] = useState('');
  const [campSessionDate, setCampSessionDate] = useState(getLocalDate);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleFile = async (file: File) => {
    setImportResult(null);
    setFileName(file.name);
    try {
      const { rows: parsed, headerError: err } = parseCsv(await readCsvFile(file));
      setRows(parsed);
      setHeaderError(err ?? '');
    } catch {
      setRows([]);
      setHeaderError('Could not read this file. Save it as a CSV and try again.');
    }
  };

  const validRowCount = rows.filter((r) => r.rowErrors.length === 0).length;
  const invalidRowCount = rows.length - validRowCount;

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await apiService.request<{ success: boolean; imported: number; duplicates: number; error?: string }>('patient:import-csv', {
        rows: rows.filter((r) => r.rowErrors.length === 0),
        importedByUserId: user?.userId,
        campSessionDate,
      });
      if (!result?.success) throw new Error(result?.error || 'The import could not be completed.');
      setImportResult({
        success: true,
        message: `Imported ${result.imported} record(s).${
          result?.duplicates ? ` ${result.duplicates} duplicate(s) skipped.` : ''
        }`,
      });
    } catch (error) {
      setImportResult({
        success: false,
        message: error instanceof Error ? error.message : 'Import failed. Check the file and try again.',
      });
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
        <label className="mb-3 block text-xs font-medium text-slate-600">
          Camp session date
          <input
            type="date"
            value={campSessionDate}
            onChange={(e) => setCampSessionDate(e.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-2 text-sm text-ink"
            required
          />
        </label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded border-2 border-dashed border-slate-300 p-6 text-sm text-slate-500 hover:border-clinical-500 hover:bg-clinical-50">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {fileName || 'Click to choose a .csv file'}
          <input
            type="file"
            accept=".csv,text/csv"
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
              disabled={importing || validRowCount === 0 || !campSessionDate}
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