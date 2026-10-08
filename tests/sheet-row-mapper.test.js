const { mapSheetValues, parseSheetDate, normalizeHeader, buildColumnIndex } = require('../electron/services/sheetRowMapper');

const ctx = { spreadsheetId: 's', sheetName: 'T', today: '2026-10-02' };
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

describe('parseSheetDate', () => {
  it('converts Google Sheets serial numbers regardless of locale', () => {
    expect(parseSheetDate(serial(2012, 5, 14))).toEqual({ value: '2012-05-14' });
    expect(parseSheetDate(serial(2012, 5, 14) + 0.75)).toEqual({ value: '2012-05-14' }); // time-of-day ignored
    expect(parseSheetDate(25569)).toEqual({ value: '1970-01-01' });
  });

  it('accepts unambiguous text dates', () => {
    expect(parseSheetDate('2012-05-14')).toEqual({ value: '2012-05-14' });
    expect(parseSheetDate('2012/5/4')).toEqual({ value: '2012-05-04' });
    expect(parseSheetDate('14/05/2012')).toEqual({ value: '2012-05-14' });
    expect(parseSheetDate('05/14/2012')).toEqual({ value: '2012-05-14' });
    expect(parseSheetDate('07/07/2012')).toEqual({ value: '2012-07-07' });
  });

  it('refuses to guess ambiguous or impossible dates', () => {
    expect(parseSheetDate('03/04/2012').error).toMatch(/ambiguous/);
    expect(parseSheetDate('31/02/2012').error).toBeDefined();
    expect(parseSheetDate('last Tuesday').error).toBeDefined();
    expect(parseSheetDate('').error).toMatch(/missing/);
  });
});

describe('column matching', () => {
  it('normalises punctuation, case and apostrophes', () => {
    expect(normalizeHeader("Child’s Name")).toBe('childsname');
    expect(normalizeHeader('Viral Load > 1000copies/ml')).toBe('viralload1000copiesml');
  });

  it('keeps child and caregiver phone numbers apart', () => {
    const { columns } = buildColumnIndex(['Cell number', 'Parent/Primary Caregiver Cell No', 'Emergency contact cell number']);
    expect(columns.cellNumber).toEqual([0]);
    expect(columns.caregiverCell).toEqual([1]);
    expect(columns.emergencyContactCell).toEqual([2]);
  });

  it('tolerates a hint appended to a question title via prefix matching', () => {
    const { columns } = buildColumnIndex(['Diagnosis (e.g. HIV, asthma)', 'Medication handed in at camp?', 'T-shirt size (youth)']);
    expect(columns.diagnosis).toEqual([0]);
    expect(columns.medicationHandedIn).toEqual([1]); // not swallowed by the shorter "medication"
    expect(columns.tShirtSize).toEqual([2]);
  });

  it('reports unrecognised columns so a typo in a safety-critical question is visible', () => {
    const { columns, ignoredColumns } = buildColumnIndex(['Timestamp', 'Email Address', 'Alergies', 'Race', '']);
    expect(columns.allergies).toBeUndefined();
    expect(ignoredColumns).toEqual(['Alergies', 'Race']);
  });

  it('lets medication span several columns but ignores duplicate single-value headers', () => {
    const { columns, ignoredColumns } = buildColumnIndex(['Medication 1', 'Medication 2', 'Surname', 'Surname']);
    expect(columns.currentMedication).toEqual([0, 1]);
    expect(columns.surname).toEqual([2]);
    expect(ignoredColumns).toEqual(['Surname']);
  });
});

describe('row mapping', () => {
  const headers = ['Timestamp', "Child's Name", 'Surname', 'Date of birth', 'Consent to disclosure', 'Allergies', 'Medication 1', 'Medication 2', 'Viral load > 1000 copies/ml', 'Media release'];

  it('maps values, splits lists and normalises yes/no and checkboxes', () => {
    const { rows } = mapSheetValues([headers, [46000.5, '  Thandi  ', 'Nkosi', serial(2012, 5, 14), 'I consent', 'Peanuts; Penicillin,  peanuts', 'Efavirenz 600mg, once daily', 'Cotrimoxazole', 'No', '']], ctx);

    expect(rows[0].errors).toEqual([]);
    expect(rows[0].profile).toMatchObject({
      firstName: 'Thandi',
      allergies: ['Peanuts', 'Penicillin'],
      currentMedication: ['Efavirenz 600mg, once daily', 'Cotrimoxazole'], // commas kept in medication lines
      viralLoadOver1000: 'no',
    });
    expect(rows[0].profile.consent).toMatchObject({ consentToDisclosure: true, consentToMediaRelease: false, formSubmittedAt: '2025-12-09 12:00:00' });
  });

  it.each(['None', 'N/A', 'no', 'No known allergies', ''])('treats allergies "%s" as none recorded', (value) => {
    const { rows } = mapSheetValues([headers, [1, 'A', 'B', serial(2012, 1, 1), 'Yes', value]], ctx);
    expect(rows[0].profile.allergies).toEqual([]);
  });

  it.each(['No', 'false', '', 'Disagree'])('does not treat consent "%s" as given', (value) => {
    const { rows } = mapSheetValues([headers, [1, 'A', 'B', serial(2012, 1, 1), value]], ctx);
    expect(rows[0].errors).toContain('Consent to disclosure was not given');
  });

  it('skips blank rows but keeps real sheet row numbers', () => {
    const { rows } = mapSheetValues([headers, [], ['', '', ''], [1, 'A', 'B', serial(2012, 1, 1), 'Yes']], ctx);
    expect(rows.map((r) => r.rowNumber)).toEqual([4]);
  });

  it('honours an optional per-row camp session date column and rejects a bad one', () => {
    const withSession = [...headers, 'Camp session date'];
    const { rows } = mapSheetValues([withSession, [1, 'A', 'B', serial(2012, 1, 1), 'Yes', '', '', '', '', '', serial(2026, 6, 29)], [2, 'C', 'D', serial(2012, 1, 1), 'Yes', '', '', '', '', '', 'soon']], ctx);
    expect(rows[0].campSessionDate).toBe('2026-06-29');
    expect(rows[1].errors).toEqual([expect.stringContaining('Camp session date')]);
  });

  it('gives identical keys for identical input and different keys for different timestamps', () => {
    const row = [1, 'A', 'B', serial(2012, 1, 1), 'Yes'];
    const a = mapSheetValues([headers, row], ctx).rows[0];
    const b = mapSheetValues([headers, row], ctx).rows[0];
    const c = mapSheetValues([headers, [2, ...row.slice(1)]], ctx).rows[0];
    const otherTab = mapSheetValues([headers, row], { ...ctx, sheetName: 'Other tab' }).rows[0];

    expect(a.sourceKey).toBe(b.sourceKey);
    expect(a.sourceKey).not.toBe(c.sourceKey);
    expect(a.sourceKey).not.toBe(otherTab.sourceKey); // two tabs with equal timestamps must never collide
  });

  it('explains an empty sheet and a sheet with the wrong headers', () => {
    expect(mapSheetValues([], ctx).headerError).toMatch(/no header row/);
    expect(mapSheetValues([['Foo', 'Bar']], ctx).headerError).toMatch(/Child's name, Surname, Date of birth, Consent to disclosure/);
  });
});

// Keep in step with the table in docs/GOOGLE_SHEET_SYNC.md: these are the exact
// question titles the guide tells the Foundation to use.
describe('Google Form setup guide', () => {
  const GUIDE_TITLES = {
    'Child\'s name': 'firstName',
    'Surname': 'surname',
    'Date of birth': 'dateOfBirth',
    'Sex': 'sex',
    'T-shirt size': 'tShirtSize',
    'Address': 'address',
    'Cell number': 'cellNumber',
    'Language spoken': 'languageSpoken',
    'Parent/Primary Caregiver name and surname': 'caregiverName',
    'Parent/Primary Caregiver cell number': 'caregiverCell',
    'Emergency contact name': 'emergencyContactName',
    'Emergency contact cell number': 'emergencyContactCell',
    'Emergency contact relationship to child': 'emergencyContactRelationship',
    'Diagnosis': 'diagnosis',
    'Clinic/Hospital file number': 'clinicFileNumber',
    'Clinic/Hospital/Doctor contact details': 'clinicContactDetails',
    'Allergies': 'allergies',
    'Current medication': 'currentMedication',
    'Medication handed in': 'medicationHandedIn',
    'Viral load > 1000 copies/ml': 'viralLoadOver1000',
    'TB history': 'tbHistory',
    'Hepatitis B': 'hepatitisB',
    'Adherence barriers': 'adherenceBarriers',
    'Dietary requirements': 'dietaryRequirements',
    'Religion': 'religion',
    'Additional information to disclose': 'additionalDisclosures',
    'Additional camper information': 'behavioralNotes',
    'Consent to disclosure': 'consentToDisclosure',
    'Media release': 'consentToMediaRelease',
    'Parent/guardian full name': 'guardianName',
    'Camp session date': 'campSessionDate',
  };

  it('maps every question title in the guide to the intended field, with nothing ignored', () => {
    const titles = ['Timestamp', ...Object.keys(GUIDE_TITLES)];
    const { columns, ignoredColumns } = buildColumnIndex(titles);

    for (const [title, field] of Object.entries(GUIDE_TITLES)) {
      expect({ title, columns: columns[field] }).toEqual({ title, columns: [titles.indexOf(title)] });
    }
    expect(ignoredColumns).toEqual([]);
  });
});
