// electron/services/sheetRowMapper.js
//
// Pure functions (no DB, no network) that turn the 2-D array read from the
// Google Form's response sheet into patient profiles the existing
// createPatientProfile() service understands, plus the identity used to make
// sure a sheet row is only ever imported once.
//
// Column matching is by header text, not position, so the Foundation can
// reorder questions or add extra staff columns to the sheet without breaking
// the sync. Headers are normalised (lower-case, punctuation/spaces removed)
// and matched against the synonym lists below — see docs/GOOGLE_SHEET_SYNC.md
// for the exact question titles the Form should use.

const crypto = require('crypto');

const FIELD_SYNONYMS = {
  timestamp: ['timestamp'],
  firstName: ['childsname', 'childname', 'childsfirstname', 'childfirstname', 'firstname', 'firstnames'],
  surname: ['surname', 'lastname', 'childssurname', 'childsurname', 'familyname'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate', 'childsdateofbirth'],
  sex: ['sex', 'gender'],
  tShirtSize: ['tshirtsize', 'tshirt', 'shirtsize'],
  address: ['address', 'homeaddress', 'residentialaddress'],
  cellNumber: ['cellnumber', 'cellno', 'childscellnumber', 'childcellnumber'],
  languageSpoken: ['languagespoken', 'language', 'homelanguage'],
  campSessionDate: ['campsessiondate', 'sessiondate', 'campdate'],
  caregiverName: ['parentprimarycaregivername', 'parentprimarycaregivernameandsurname', 'parentcaregivername', 'parentcaregivernameandsurname', 'primarycaregivername', 'caregivername', 'parentname'],
  caregiverCell: ['parentprimarycaregivercellnumber', 'parentprimarycaregivercellno', 'parentcaregivercellnumber', 'parentcaregivercellno', 'primarycaregivercellnumber', 'caregivercellnumber', 'caregivercellno', 'caregivercell', 'parentcellnumber', 'parentcellno'],
  emergencyContactName: ['emergencycontactname', 'emergencycontactpersonsname', 'emergencycontactperson', 'contactpersonsname'],
  emergencyContactCell: ['emergencycontactcellnumber', 'emergencycontactcellno', 'emergencycontactcell', 'emergencycontactnumber', 'contactpersoncellnumber', 'contactpersoncellno'],
  emergencyContactRelationship: ['emergencycontactrelationship', 'emergencycontactrelationshiptochild', 'relationshiptochild'],
  diagnosis: ['diagnosis', 'primarydiagnosis'],
  clinicFileNumber: ['clinichospitalfilenumber', 'clinicfilenumber', 'hospitalfilenumber', 'filenumber'],
  clinicContactDetails: ['clinichospitaldoctorcontactdetails', 'clinichospitalcontactdetails', 'clinicdoctorcontactdetails', 'clinicdetails'],
  allergies: ['allergies', 'knownallergies'],
  currentMedication: ['currentmedication', 'currentmedications', 'medication', 'medications', 'medication1', 'medication2', 'medication3', 'medication4'],
  medicationHandedIn: ['medicationhandedin', 'medicationhandedintocamp'],
  viralLoadOver1000: ['viralload1000copiesml', 'viralloadover1000', 'viralload1000', 'viralload'],
  tbHistory: ['tbhistory'],
  hepatitisB: ['hepatitisb'],
  adherenceBarriers: ['adherencebarriers'],
  dietaryRequirements: ['dietaryrequirements', 'specialdietaryrequirements'],
  religion: ['religion', 'religiousaffiliation', 'campersreligiousaffiliation'],
  additionalDisclosures: ['additionalinformationtodisclose', 'additionaldisclosures'],
  behavioralNotes: ['additionalcamperinformation', 'behavioralnotes', 'behaviouralnotes'],
  guardianName: ['guardianname', 'parentguardianfullname', 'parentguardianname', 'consentgivenby'],
  consentToDisclosure: ['consenttodisclosure', 'consentdisclosure'],
  consentToMediaRelease: ['mediarelease', 'consenttomediarelease'],
  // What this column holds (a file name, an embedded image, or a link) is
  // interpreted by registrationPhotos.js. The Google Form cannot collect
  // photos itself, so this is normally an extra column staff add to the sheet.
  photo: ['photo', 'childsphoto', 'camperphoto', 'photoofchild', 'photofile', 'photofilename'],
};

// A field that may legitimately be spread over several columns (Medication 1..4).
const MULTI_COLUMN_FIELDS = new Set(['currentMedication']);

// Without these a row can't be turned into a valid, consented patient record.
const REQUIRED_FIELDS = {
  firstName: "Child's name",
  surname: 'Surname',
  dateOfBirth: 'Date of birth',
  consentToDisclosure: 'Consent to disclosure',
};

// Columns that are expected to be unused; not worth warning about.
// 'indemnityagreement' is the Form's required tick-box for the indemnity. It
// is stored in the sheet as the record of agreement but has no CHRS field.
const SILENTLY_IGNORED_HEADERS = new Set(['', 'timestamp', 'emailaddress', 'email', 'score', 'indemnityagreement']);

// Prefix matching lets a Form question carry a trailing hint
// ("Diagnosis (e.g. HIV, asthma)") without breaking the mapping. Short
// synonyms are excluded so "sex" can't swallow some unrelated column.
const MIN_PREFIX_SYNONYM_LENGTH = 7;

function normalizeHeader(header) {
  return String(header ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).trim();
}

const singleLine = (value) => cellText(value).replace(/\s+/g, ' ');

const NOTHING_RECORDED = /^(none|nil|n\/a|na|no|-|none known|no known allergies|no allergies)$/i;

function splitList(value, { splitOnCommas }) {
  const text = cellText(value);
  if (!text || NOTHING_RECORDED.test(text)) return [];
  const separator = splitOnCommas ? /[\n;,]+/ : /[\n;]+/;
  const seen = new Set();
  return text.split(separator).map((item) => item.trim()).filter((item) => {
    if (!item || NOTHING_RECORDED.test(item) || seen.has(item.toLowerCase())) return false;
    seen.add(item.toLowerCase());
    return true;
  });
}

function yesNo(value) {
  const text = cellText(value).toLowerCase();
  if (/^(yes|y|true)\b/.test(text)) return 'yes';
  if (/^(no|n|false)\b/.test(text)) return 'no';
  return '';
}

// Checkbox answers arrive as the option's text ("I consent"); a blank cell
// means the box was never ticked.
function isAffirmative(value) {
  const text = cellText(value);
  return text !== '' && !/^(no|n|false|0|disagree|decline|not)\b/i.test(text);
}

function isoFromParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

/**
 * Converts a sheet cell to YYYY-MM-DD.
 *  - A real Sheets date arrives as a serial number (days since 1899-12-30):
 *    unambiguous, no locale involved.
 *  - Text dates are accepted as YYYY-MM-DD / YYYY/MM/DD, or D/M/YYYY only when
 *    the day is greater than 12. "03/04/2012" is rejected rather than guessed,
 *    because a wrong date of birth on a medical record is worse than a row
 *    that gets flagged for someone to fix in the sheet.
 */
function parseSheetDate(value) {
  let iso = null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { error: 'is not a valid date' };
    const ms = Date.UTC(1970, 0, 1) + (Math.floor(value) - 25569) * 86400000;
    iso = new Date(ms).toISOString().slice(0, 10);
  } else {
    const text = cellText(value);
    if (!text) return { error: 'is missing' };

    const yearFirst = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
    const yearLast = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (yearFirst) {
      iso = isoFromParts(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
    } else if (yearLast) {
      const [first, second, year] = [Number(yearLast[1]), Number(yearLast[2]), Number(yearLast[3])];
      if (first > 12) iso = isoFromParts(year, second, first);
      else if (second > 12) iso = isoFromParts(year, first, second);
      else if (first === second) iso = isoFromParts(year, first, second);
      else return { error: `"${text}" is ambiguous (day/month or month/day?). Re-enter it as YYYY-MM-DD` };
    }
    if (!iso) return { error: `"${text}" is not a recognised date` };
  }

  return { value: iso };
}

// Forms stamps responses in the spreadsheet's own time zone, so the serial
// number is a wall-clock time with no zone. Render it as such rather than
// pretending it is UTC.
function describeTimestamp(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return cellText(raw) || null;
  const ms = Date.UTC(1970, 0, 1) + Math.round((raw - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Works out which column feeds which field.
 * @returns {{ columns: Record<string, number[]>, ignoredColumns: string[] }}
 */
function buildColumnIndex(headerRow) {
  const synonymToField = new Map();
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    for (const synonym of synonyms) synonymToField.set(synonym, field);
  }
  const prefixCandidates = [...synonymToField.keys()]
    .filter((synonym) => synonym.length >= MIN_PREFIX_SYNONYM_LENGTH)
    .sort((a, b) => b.length - a.length);

  const columns = {};
  const unmatched = [];

  const claim = (field, index) => {
    if (columns[field] && !MULTI_COLUMN_FIELDS.has(field)) return false;
    (columns[field] ??= []).push(index);
    return true;
  };

  // Pass 1: exact matches always win.
  headerRow.forEach((header, index) => {
    const field = synonymToField.get(normalizeHeader(header));
    if (!field || !claim(field, index)) unmatched.push(index);
  });

  // Pass 2: prefix matches for whatever is left.
  const ignoredColumns = [];
  for (const index of unmatched) {
    const normalized = normalizeHeader(headerRow[index]);
    const prefix = prefixCandidates.find((synonym) => normalized.startsWith(synonym));
    const field = prefix ? synonymToField.get(prefix) : null;
    if (field && claim(field, index)) continue;
    if (!SILENTLY_IGNORED_HEADERS.has(normalized)) ignoredColumns.push(cellText(headerRow[index]));
  }

  return { columns, ignoredColumns };
}

function mapRow(cells, { columns, rowNumber, occurrence, context, today }) {
  const first = (field) => (columns[field] ? cells[columns[field][0]] : undefined);
  const all = (field) => (columns[field] ?? []).map((index) => cells[index]);
  const errors = [];

  const firstName = singleLine(first('firstName'));
  const surname = singleLine(first('surname'));
  if (!firstName) errors.push("Child's name is missing");
  if (!surname) errors.push('Surname is missing');

  const dob = parseSheetDate(first('dateOfBirth'));
  if (dob.error) errors.push(`Date of birth ${dob.error}`);
  else if (dob.value > today) errors.push('Date of birth is in the future');
  else if (dob.value < '1900-01-01') errors.push('Date of birth is not a plausible date');

  const consentToDisclosure = isAffirmative(first('consentToDisclosure'));
  if (!consentToDisclosure) errors.push('Consent to disclosure was not given');

  let campSessionDate = null;
  if (cellText(first('campSessionDate')) !== '') {
    const parsed = parseSheetDate(first('campSessionDate'));
    if (parsed.error) errors.push(`Camp session date ${parsed.error}`);
    else campSessionDate = parsed.value;
  }

  const rawTimestamp = cellText(first('timestamp'));

  // Hash of the cells the sync actually reads. Extra staff columns added to
  // the sheet (e.g. "Checked by") don't count, so they can't register as the
  // child's details having changed.
  const contentHash = sha256(JSON.stringify(
    Object.keys(columns)
      .filter((field) => field !== 'timestamp')
      .sort()
      .map((field) => [field, all(field).map(cellText)])
  ));

  // Identity of this sheet row. The Forms timestamp is set once when the
  // response arrives and does not change if staff later correct a typo in
  // the sheet, so a corrected row is still recognised as the same row.
  // `occurrence` disambiguates two responses stamped in the same second.
  const sourceKey = sha256(rawTimestamp
    ? `${context.spreadsheetId}|${context.sheetName}|ts:${rawTimestamp}#${occurrence}`
    : `${context.spreadsheetId}|${context.sheetName}|nots:${contentHash}`);

  const profile = {
    firstName,
    surname,
    dateOfBirth: dob.value ?? '',
    sex: singleLine(first('sex')),
    tShirtSize: singleLine(first('tShirtSize')),
    address: cellText(first('address')),
    cellNumber: singleLine(first('cellNumber')),
    languageSpoken: singleLine(first('languageSpoken')),
    caregiverName: singleLine(first('caregiverName')),
    caregiverCell: singleLine(first('caregiverCell')),
    emergencyContactName: singleLine(first('emergencyContactName')),
    emergencyContactCell: singleLine(first('emergencyContactCell')),
    emergencyContactRelationship: singleLine(first('emergencyContactRelationship')),
    diagnosis: singleLine(first('diagnosis')),
    clinicFileNumber: singleLine(first('clinicFileNumber')),
    clinicContactDetails: cellText(first('clinicContactDetails')),
    allergies: splitList(first('allergies'), { splitOnCommas: true }),
    currentMedication: splitList(all('currentMedication').map(cellText).filter(Boolean).join('\n'), { splitOnCommas: false }),
    medicationHandedIn: yesNo(first('medicationHandedIn')),
    viralLoadOver1000: yesNo(first('viralLoadOver1000')),
    tbHistory: cellText(first('tbHistory')),
    hepatitisB: yesNo(first('hepatitisB')),
    adherenceBarriers: cellText(first('adherenceBarriers')),
    dietaryRequirements: cellText(first('dietaryRequirements')),
    religion: singleLine(first('religion')),
    behavioralNotes: cellText(first('behavioralNotes')),
    additionalDisclosures: cellText(first('additionalDisclosures')),
    // Google Forms can record that the box was ticked and who typed their
    // name, but it cannot capture a handwritten/drawn signature. Those stay
    // null here and the signed indemnity is still collected separately.
    consent: {
      guardianName: singleLine(first('guardianName')) || singleLine(first('caregiverName')),
      consentToDisclosure,
      consentToMediaRelease: isAffirmative(first('consentToMediaRelease')),
      guardianSignature: null,
      witnessName: '',
      witnessSignature: null,
      source: 'google_form',
      formSubmittedAt: describeTimestamp(first('timestamp')),
    },
  };

  // Resolved to an image (or to nothing) by the caller; see registrationPhotos.js.
  const photoReference = cellText(first('photo'));

  return { rowNumber, errors, profile, photoReference, campSessionDate, sourceKey, contentHash };
}

/**
 * @param {any[][]} values  Sheet contents, first row = headers.
 * @param {{ spreadsheetId: string, sheetName: string, today?: string }} context
 * @returns {{ headerError?: string, rows: object[], ignoredColumns: string[] }}
 */
function mapSheetValues(values, context) {
  if (!Array.isArray(values) || values.length === 0) {
    return { headerError: 'The sheet is empty: it has no header row yet. Submit a test response through the Google Form first.', rows: [], ignoredColumns: [] };
  }

  const { columns, ignoredColumns } = buildColumnIndex(values[0]);
  const missing = Object.entries(REQUIRED_FIELDS).filter(([field]) => !columns[field]).map(([, label]) => label);
  if (missing.length > 0) {
    return {
      headerError: `The sheet is missing required column(s): ${missing.join(', ')}. Check the Google Form question titles against the setup guide.`,
      rows: [],
      ignoredColumns,
    };
  }

  const today = context.today ?? new Date().toISOString().slice(0, 10);
  const occurrences = new Map();
  const rows = [];

  values.slice(1).forEach((cells, offset) => {
    if (!Array.isArray(cells) || cells.every((cell) => cellText(cell) === '')) return; // blank row

    // Counted for every row (valid or not) so a row's identity never shifts
    // just because a neighbouring row was fixed or flagged.
    const rawTimestamp = columns.timestamp ? cellText(cells[columns.timestamp[0]]) : '';
    const occurrence = occurrences.get(rawTimestamp) ?? 0;
    occurrences.set(rawTimestamp, occurrence + 1);

    rows.push(mapRow(cells, { columns, rowNumber: offset + 2, occurrence, context, today }));
  });

  return { rows, ignoredColumns, photoColumnFound: Boolean(columns.photo) };
}

module.exports = {
  normalizeHeader,
  parseSheetDate,
  buildColumnIndex,
  mapSheetValues,
  REQUIRED_FIELDS,
};
