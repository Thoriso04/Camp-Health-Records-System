const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSheetsClient, loadSyncConfig, readServiceAccountKey, extractSpreadsheetId, SheetSyncError } = require('../electron/services/googleSheetsClient');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const serviceAccount = { clientEmail: 'reader@chrs.iam.gserviceaccount.com', privateKey };

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('Google Sheets client', () => {
  it('signs a valid RS256 service-account JWT with read-only scope and exchanges it for a token', async () => {
    const fetchImpl = jest.fn(async (url) => (url.includes('oauth2')
      ? json(200, { access_token: 'tok-1', expires_in: 3600 })
      : json(200, { values: [['Timestamp'], [1]] })));

    const values = await createSheetsClient({ serviceAccount, fetchImpl }).readSheetValues({ spreadsheetId: 'sheet-1', sheetName: "Camp's Responses" });

    expect(values).toEqual([['Timestamp'], [1]]);

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(tokenInit.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

    const [header, claims, signature] = form.get('assertion').split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url'))).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claimBody = JSON.parse(Buffer.from(claims, 'base64url'));
    expect(claimBody).toMatchObject({ iss: serviceAccount.clientEmail, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token' });
    const verified = crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'));
    expect(verified).toBe(true);

    const [sheetUrl, sheetInit] = fetchImpl.mock.calls[1];
    expect(sheetInit.headers.Authorization).toBe('Bearer tok-1');
    expect(sheetUrl).toContain('/spreadsheets/sheet-1/values/');
    expect(decodeURIComponent(sheetUrl)).toContain("'Camp''s Responses'"); // quote escaped
    expect(sheetUrl).toContain('valueRenderOption=UNFORMATTED_VALUE');
    expect(sheetUrl).toContain('dateTimeRenderOption=SERIAL_NUMBER');
  });

  it('reuses the access token until it is about to expire', async () => {
    let clock = 1_000_000;
    const fetchImpl = jest.fn(async (url) => (url.includes('oauth2') ? json(200, { access_token: 't', expires_in: 3600 }) : json(200, { values: [] })));
    const client = createSheetsClient({ serviceAccount, fetchImpl, now: () => clock });
    const read = () => client.readSheetValues({ spreadsheetId: 's', sheetName: 'T' });

    await read();
    await read();
    expect(fetchImpl.mock.calls.filter(([u]) => u.includes('oauth2'))).toHaveLength(1);

    clock += 3600 * 1000; // expired
    await read();
    expect(fetchImpl.mock.calls.filter(([u]) => u.includes('oauth2'))).toHaveLength(2);
  });

  it('returns an empty array for a sheet with no data', async () => {
    const fetchImpl = async (url) => (url.includes('oauth2') ? json(200, { access_token: 't', expires_in: 3600 }) : json(200, { range: 'T!A1:Z1000' }));
    expect(await createSheetsClient({ serviceAccount, fetchImpl }).readSheetValues({ spreadsheetId: 's', sheetName: 'T' })).toEqual([]);
  });

  it.each([
    [403, {}, 'NO_ACCESS', /Share the responses sheet with reader@chrs\.iam\.gserviceaccount\.com/],
    [404, {}, 'NOT_FOUND', /spreadsheet was not found/],
    [400, { error: { message: 'Unable to parse range: Nope' } }, 'BAD_TAB', /tab "Nope" does not exist/],
    [500, {}, 'GOOGLE_ERROR', /unexpected error \(500\)/],
  ])('translates a Sheets %i response into a plain-English error', async (status, body, code, message) => {
    const fetchImpl = async (url) => (url.includes('oauth2') ? json(200, { access_token: 't', expires_in: 3600 }) : json(status, body));
    await expect(createSheetsClient({ serviceAccount, fetchImpl }).readSheetValues({ spreadsheetId: 's', sheetName: 'Nope' }))
      .rejects.toMatchObject({ name: 'SheetSyncError', code, message: expect.stringMatching(message) });
  });

  it('reports a rejected key (e.g. wrong laptop clock) as an auth problem', async () => {
    const fetchImpl = async () => json(400, { error: 'invalid_grant', error_description: 'Invalid JWT' });
    await expect(createSheetsClient({ serviceAccount, fetchImpl }).getAccessToken())
      .rejects.toMatchObject({ code: 'AUTH', message: expect.stringContaining('date and time are correct') });
  });

  it('reports no connectivity as OFFLINE with reassurance that the rest of the app works', async () => {
    const fetchImpl = async () => { throw new TypeError('fetch failed'); };
    const error = await createSheetsClient({ serviceAccount, fetchImpl }).readSheetValues({ spreadsheetId: 's', sheetName: 'T' }).catch((e) => e);

    expect(error).toBeInstanceOf(SheetSyncError);
    expect(error.code).toBe('OFFLINE');
    expect(error.message).toMatch(/keeps working offline/);
  });

  it('never leaks the private key or token into error messages', async () => {
    const fetchImpl = async (url) => (url.includes('oauth2') ? json(200, { access_token: 'SECRET-TOKEN', expires_in: 3600 }) : json(403, {}));
    const error = await createSheetsClient({ serviceAccount, fetchImpl }).readSheetValues({ spreadsheetId: 's', sheetName: 'T' }).catch((e) => e);
    expect(error.message).not.toContain('SECRET-TOKEN');
    expect(error.message).not.toContain('PRIVATE KEY');
  });
});

describe('sync configuration', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrs-sync-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('accepts a bare id or a full sheet URL', () => {
    expect(extractSpreadsheetId('1AbC_dEf-123')).toBe('1AbC_dEf-123');
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit?gid=0#gid=0')).toBe('1AbC_dEf-123');
  });

  it('returns null when sync has not been set up', () => {
    expect(loadSyncConfig({ env: {}, userDataDir: dir })).toBeNull();
  });

  it('reads google-sync.json from the userData folder, resolving the key path against it', () => {
    fs.writeFileSync(path.join(dir, 'google-sync.json'), JSON.stringify({ spreadsheetId: 'abc', serviceAccountKeyFile: 'key.json' }));
    expect(loadSyncConfig({ env: {}, userDataDir: dir })).toEqual({ spreadsheetId: 'abc', sheetName: 'Form Responses 1', keyFilePath: path.join(dir, 'key.json') });
  });

  it('lets environment variables override the file', () => {
    fs.writeFileSync(path.join(dir, 'google-sync.json'), JSON.stringify({ spreadsheetId: 'from-file', serviceAccountKeyFile: 'key.json' }));
    const config = loadSyncConfig({ env: { GOOGLE_SHEET_ID: 'from-env', GOOGLE_SHEET_TAB: 'Camp 117' }, userDataDir: dir });
    expect(config).toMatchObject({ spreadsheetId: 'from-env', sheetName: 'Camp 117' });
  });

  it('gives a clear message for malformed config or key files', () => {
    fs.writeFileSync(path.join(dir, 'google-sync.json'), '{ not json');
    expect(() => loadSyncConfig({ env: {}, userDataDir: dir })).toThrow(/not valid JSON/);

    expect(() => readServiceAccountKey(path.join(dir, 'missing.json'))).toThrow(/not found/);
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ client_email: 'x' }));
    expect(() => readServiceAccountKey(path.join(dir, 'bad.json'))).toThrow(/missing client_email or private_key/);
    fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ client_email: 'a@b', private_key: 'k' }));
    expect(readServiceAccountKey(path.join(dir, 'ok.json'))).toEqual({ clientEmail: 'a@b', privateKey: 'k' });
  });
});
