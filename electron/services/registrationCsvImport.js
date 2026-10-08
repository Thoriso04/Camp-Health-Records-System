// electron/services/registrationCsvImport.js
//
// Imports registrations from a CSV downloaded from the Google Form's response
// sheet (Sheet > File > Download > Comma-separated values). It exists so the
// laptops never *depend* on Google's API: a CSV can be carried in on a USB
// stick, and works with no internet and no service-account setup.
//
// It does not re-implement any import logic. The CSV becomes the same 2-D
// array the Sheets API returns and is handed to sheetSyncService, so it gets
// the same column matching, the same ledger, the same duplicate checks and the
// same single transaction as the Sync button.
//
// Identity of a row: the ledger key is built from a FIXED source name below,
// never from the file's name or location. Re-downloading the sheet (a new
// file name, a bigger file, a different laptop) therefore still recognises
// every row it has already imported. Rows imported earlier through the Google
// API carry a different ledger key; those are still caught by the natural-key
// check (first name + surname + date of birth + session date).

const Papa = require('papaparse');
const { SheetSyncError } = require('./googleSheetsClient');
const { applySheetValues, previewSheetValues, logFailedSync } = require('./sheetSyncService');
const { resolveActiveUserId } = require('./userService');

const CSV_SOURCE = Object.freeze({
  spreadsheetId: 'csv-import',
  sheetName: 'registration-responses',
});

const MAX_CSV_BYTES = 10 * 1024 * 1024;

function toBuffer(input) {
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new SheetSyncError('The CSV file could not be read.', 'BAD_CSV');
}

/**
 * Bytes -> text. Google's download is UTF-8, but Excel's "CSV" is often UTF-8
 * with a BOM, UTF-16, or the legacy Windows-1252 code page. Decoding
 * Windows-1252 as UTF-8 would silently turn "Zoë" into "Zo\uFFFD", so UTF-8 is
 * tried strictly first and Windows-1252 is the fallback.
 */
function decodeCsvBytes(input) {
  const bytes = toBuffer(input);
  if (bytes.length > MAX_CSV_BYTES) {
    throw new SheetSyncError(`That file is too large to be a registration export (${Math.round(bytes.length / 1048576)} MB).`, 'BAD_CSV');
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));

  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch (_) {
    return new TextDecoder('windows-1252').decode(body);
  }
}

/**
 * CSV text -> 2-D array of strings with the header row first.
 *
 * Blank lines are deliberately kept (the mapper skips blank rows itself) so
 * that row N in a report is row N of the spreadsheet. Semicolons and tabs are
 * accepted as well as commas, because Excel in South African regional
 * settings writes semicolon-separated files.
 */
function parseCsvToValues(text) {
  const result = Papa.parse(text, { delimitersToGuess: [',', ';', '\t'], skipEmptyLines: false });
  const quoteProblem = result.errors.find((error) => error.type === 'Quotes');
  if (quoteProblem) {
    throw new SheetSyncError(
      `The CSV file looks damaged (unclosed quotation mark near row ${quoteProblem.row + 1}). Download it again from Google Sheets.`,
      'BAD_CSV'
    );
  }
  const values = result.data;
  // Drop blank records at the very end (the file's closing newline). Blank
  // records in the middle stay so row numbers still match the spreadsheet.
  while (values.length > 0 && values[values.length - 1].every((cell) => cell === '')) values.pop();
  if (values.length === 0) {
    throw new SheetSyncError('The CSV file is empty.', 'BAD_CSV');
  }
  return values;
}

function toSyncOptions({ csvBytes, fileName, campSessionDate, photoFiles, today }) {
  return {
    values: parseCsvToValues(decodeCsvBytes(csvBytes)),
    ...CSV_SOURCE,
    campSessionDate,
    photoFiles,
    today,
    sourceType: 'csv_file',
    sourceName: fileName,
  };
}

/** Read-only: what would importing this file do? Writes nothing. */
function previewRegistrationCsv(db, input) {
  return previewSheetValues(db, toSyncOptions(input));
}

/** Imports the file. All-or-nothing; failures are recorded in the sync log. */
function importRegistrationCsv(db, input) {
  try {
    return applySheetValues(db, { ...toSyncOptions(input), syncedByUserId: input.importedByUserId });
  } catch (error) {
    let userId = null;
    try { userId = resolveActiveUserId(db, input.importedByUserId); } catch (_) { /* not a DB user */ }
    logFailedSync(db, userId, error, 'csv_file');
    throw error;
  }
}

module.exports = {
  CSV_SOURCE,
  decodeCsvBytes,
  parseCsvToValues,
  previewRegistrationCsv,
  importRegistrationCsv,
};
