const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildColumnIndex, REQUIRED_FIELDS } = require('../electron/services/sheetRowMapper');

// Runs docs/google-form/create-registration-form.gs against a mock of Google's
// Form/Sheet APIs and checks what it builds against what the sync expects, so
// the script, the setup guide and the mapper can't drift apart.

const SCRIPT = fs.readFileSync(path.join(__dirname, '../docs/google-form/create-registration-form.gs'), 'utf8');

function runScript() {
  const items = [];                 // everything added to the form, in order
  const calls = { formatted: [], logs: [], deletedSheets: [], formSettings: {} };

  const item = (kind) => {
    const it = { kind, required: false, choices: null, validation: null };
    const chain = new Proxy(it, {
      get(target, prop) {
        if (prop in target) return target[prop];
        const setters = {
          setTitle: (v) => { target.title = v; return chain; },
          setHelpText: (v) => { target.helpText = v; return chain; },
          setRequired: (v) => { target.required = v; return chain; },
          setIncludesYear: () => chain,
          setValidation: (v) => { target.validation = v; return chain; },
          setChoices: (v) => { target.choices = v; return chain; },
          createChoice: (v) => v,
        };
        return setters[prop];
      },
    });
    items.push(it);
    return chain;
  };

  let titles = [];
  const questionTitles = () => items.filter((i) => i.title && !['pagebreak', 'header'].includes(i.kind)).map((i) => i.title);

  const sheet = {
    getName: () => 'Form Responses 1',
    getLastColumn: () => titles.length,
    getMaxRows: () => 1000,
    getRange: (row, col, nRows, nCols) => ({
      getValues: () => [titles],
      setNumberFormat: (fmt) => { calls.formatted.push({ col, row, nRows, fmt, header: titles[col - 1] }); },
    }),
  };
  const spreadsheet = {
    getId: () => 'SHEET123', getUrl: () => 'https://docs.google.com/spreadsheets/d/SHEET123',
    getSheets: () => [{ getName: () => 'Sheet1' }, sheet],
    getSheetByName: (n) => (n === 'Sheet1' ? { name: 'Sheet1' } : null),
    deleteSheet: (s) => calls.deletedSheets.push(s.name),
  };

  const form = new Proxy({}, {
    get(_t, prop) {
      const adders = {
        addTextItem: () => item('text'), addParagraphTextItem: () => item('paragraph'),
        addDateItem: () => item('date'), addMultipleChoiceItem: () => item('choice'),
        addCheckboxItem: () => item('checkbox'), addPageBreakItem: () => item('pagebreak'),
        addSectionHeaderItem: () => item('header'),
        setDestination: () => { titles = ['Timestamp', ...questionTitles()]; calls.destinationSet = true; },
        getEditUrl: () => 'edit-url', getPublishedUrl: () => 'live-url',
      };
      if (adders[prop]) return adders[prop];
      return (...args) => { calls.formSettings[prop] = args[0]; return form; };
    },
  });

  const validationBuilder = { setHelpText() { return this; }, requireTextMatchesPattern(p) { this.pattern = p; return this; }, build() { return { pattern: this.pattern }; } };

  const context = {
    FormApp: { create: (t) => { calls.formTitle = t; return form; }, createTextValidation: () => ({ ...validationBuilder }), DestinationType: { SPREADSHEET: 'SPREADSHEET' } },
    SpreadsheetApp: { create: () => spreadsheet, openById: () => spreadsheet, flush() {} },
    Utilities: { sleep() {} },
    Logger: { log: (m) => calls.logs.push(m) },
  };
  vm.createContext(context);
  vm.runInContext(SCRIPT + '\n;createRegistrationForm();', context);
  return { items, calls, titles, context };
}

describe('Google Form creation script', () => {
  const run = runScript();
  const questions = run.items.filter((i) => !['pagebreak', 'header'].includes(i.kind));
  const questionTitles = questions.map((q) => q.title);

  it('creates the form, links a sheet, and reports the links', () => {
    expect(run.calls.destinationSet).toBe(true);
    expect(run.calls.logs.join('\n')).toMatch(/live-url/);
    expect(run.calls.logs.join('\n')).toMatch(/SHEET123/);
    expect(run.calls.deletedSheets).toEqual(['Sheet1']);
  });

  it('every question title is recognised by the sync, with nothing ignored', () => {
    const { columns, ignoredColumns } = buildColumnIndex(['Timestamp', ...questionTitles]);
    expect(ignoredColumns).toEqual([]);
    // 30 mapped questions + the automatic Timestamp. The Indemnity tick-box is deliberately unmapped (silently ignored).
    expect(Object.keys(columns)).toHaveLength(questionTitles.length);
    expect(Object.keys(columns)).toContain('timestamp');
    expect(questionTitles).toContain('Indemnity agreement');
    expect(new Set(questionTitles).size).toBe(questionTitles.length); // no duplicate titles
  });

  it('makes every column the sync needs a required question, so a response can never be unimportable', () => {
    const { columns } = buildColumnIndex(['Timestamp', ...questionTitles]);
    for (const field of Object.keys(REQUIRED_FIELDS)) {
      expect(columns[field]).toBeDefined();
      expect(questions[columns[field][0] - 1].required).toBe(true);
    }
  });

  it('requires the safety-critical and legal questions', () => {
    const required = questions.filter((q) => q.required).map((q) => q.title);
    expect(required).toEqual(expect.arrayContaining(['Allergies', 'Diagnosis', 'Consent to disclosure', 'Indemnity agreement', 'Parent/guardian full name', 'Emergency contact cell number']));
  });

  it('uses a Date question for date of birth (unambiguous in the sheet)', () => {
    expect(questions.find((q) => q.title === 'Date of birth').kind).toBe('date');
  });

  it('validates phone numbers and formats exactly those sheet columns as plain text', () => {
    const phones = questions.filter((q) => q.validation).map((q) => q.title);
    expect(phones).toEqual(['Cell number', 'Parent/Primary Caregiver cell number', 'Emergency contact cell number']);

    const pattern = new RegExp(questions.find((q) => q.title === 'Cell number').validation.pattern);
    ['0821234567', '082 123 4567', '+27 82 123 4567', '(018) 297-1234'].forEach((n) => expect(n).toMatch(pattern));
    ['abc', '12345', '082-ABC-4567'].forEach((n) => expect(n).not.toMatch(pattern));

    expect(run.calls.formatted.map((f) => f.header)).toEqual(phones);
    run.calls.formatted.forEach((f) => expect(f).toMatchObject({ fmt: '@', row: 2, nRows: 999 }));
  });

  it('uses consent checkbox wording the sync reads as "given"', () => {
    for (const title of ['Consent to disclosure', 'Media release', 'Indemnity agreement']) {
      const q = questions.find((x) => x.title === title);
      expect(q.kind).toBe('checkbox');
      expect(q.choices).toHaveLength(1);
      expect(q.choices[0]).not.toMatch(/^(no|n|not|false|0|disagree|decline)\b/i);
    }
  });

  it('carries the Foundation\'s consent and indemnity wording and the camp settings', () => {
    const headers = run.items.filter((i) => i.kind === 'header').map((i) => i.helpText || '').join('\n');
    expect(headers).toContain('consent to disclosure of my clinical records to Just Footprints Foundation (JFF)');
    expect(headers).toContain('POPI Act');
    expect(headers).toContain('29 June to 3 July 2026');
    expect(headers).toContain('Twinstreams');
    expect(run.calls.formTitle).toBe('JFF Camp #117: Camper Registration');
  });

  it("doesn't require parents to have a Google account or share their email, and keeps 'submit another response' for siblings", () => {
    expect(run.calls.formSettings.setRequireLogin).toBe(false);
    expect(run.calls.formSettings.setCollectEmail).toBe(false);
    expect(run.calls.formSettings.setShowLinkToRespondAgain).toBe(true);
  });

  it('tolerates Workspace-only settings failing', () => {
    // trySetting_ swallows errors; assert it is wired up rather than letting a consumer account crash the run.
    expect(SCRIPT).toMatch(/trySetting_\(function \(\) \{ form\.setRequireLogin/);
  });
});
