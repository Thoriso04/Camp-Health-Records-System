const crypto = require('crypto');
const { createDriveClient, downloadDrivePhotos, MAX_IDS_PER_REQUEST } = require('../electron/services/googleDriveClient');
const { SheetSyncError } = require('../electron/services/googleSheetsClient');

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const serviceAccount = { clientEmail: 'reader@chrs.iam.gserviceaccount.com', privateKey };

const ID_A = '1AbCdEfGhIjKlMnOp';
const ID_B = '2ZyXwVuTsRqPoNmLk';
const ID_C = '3QqWwEeRrTtYyUuIi';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });
const fileResponse = (bytes, headers = {}) => ({
  ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(bytes).buffer, headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

function fakeGoogle(handler) {
  return jest.fn(async (url, init) => {
    if (url.includes('oauth2')) return jsonResponse(200, { access_token: 'tok', expires_in: 3600 });
    return handler(url, init);
  });
}

describe('Google Drive photo client', () => {
  it('asks only for the read-only Drive scope and downloads the file bytes', async () => {
    const fetchImpl = fakeGoogle(() => fileResponse([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    const bytes = await createDriveClient({ serviceAccount, fetchImpl }).downloadFile(ID_A);

    expect([...bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    const claims = JSON.parse(Buffer.from(new URLSearchParams(fetchImpl.mock.calls[0][1].body).get('assertion').split('.')[1], 'base64url'));
    expect(claims.scope).toBe('https://www.googleapis.com/auth/drive.readonly');

    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe(`https://www.googleapis.com/drive/v3/files/${ID_A}?alt=media&supportsAllDrives=true`);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.method).toBeUndefined(); // a plain GET: it can never modify anything
  });

  it('refuses anything that is not a plausible file id before making a request', async () => {
    const fetchImpl = jest.fn();
    const client = createDriveClient({ serviceAccount, fetchImpl });
    for (const bad of ['', 'short', '../../etc/passwd', 'abc/def/ghijklmnop', 'a b c d e f g h i j k', undefined]) {
      await expect(client.downloadFile(bad)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe('failures', () => {
    const download = (handler) => createDriveClient({ serviceAccount, fetchImpl: fakeGoogle(handler) }).downloadFile(ID_A);

    it('explains that a 404 usually means the folder is not shared with the service account', async () => {
      await expect(download(() => jsonResponse(404, { error: { message: 'File not found' } }))).rejects.toMatchObject({
        code: 'NO_ACCESS',
        message: expect.stringContaining(serviceAccount.clientEmail),
      });
    });

    it('tells staff to enable the Drive API when Google says it is off', async () => {
      const body = { error: { message: 'Google Drive API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } };
      await expect(download(() => jsonResponse(403, body))).rejects.toMatchObject({ code: 'DRIVE_API_DISABLED', message: expect.stringMatching(/Google Drive API/) });
    });

    it('reports a rate limit as a temporary problem, not an access problem', async () => {
      await expect(download(() => jsonResponse(403, { error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } }))).rejects.toMatchObject({ code: 'GOOGLE_ERROR' });
    });

    it('maps no connection to OFFLINE', async () => {
      const fetchImpl = jest.fn(async () => { throw new TypeError('fetch failed'); });
      await expect(createDriveClient({ serviceAccount, fetchImpl }).downloadFile(ID_A)).rejects.toMatchObject({ code: 'OFFLINE' });
    });

    it('refuses an oversized download, by header and by actual size', async () => {
      await expect(download(() => fileResponse([1], { 'content-length': String(30 * 1024 * 1024) }))).rejects.toMatchObject({ code: 'TOO_LARGE' });
      // no content-length header: the real size is checked after reading
      const huge = { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(26 * 1024 * 1024), headers: { get: () => null } };
      await expect(download(() => huge)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    });

    it('does not leak the token or key into error messages', async () => {
      const error = await download(() => jsonResponse(500, {})).catch((e) => e);
      expect(error).toBeInstanceOf(SheetSyncError);
      expect(error.message).not.toMatch(/tok|BEGIN/);
    });
  });

  describe('downloadFiles (several photos)', () => {
    it('returns what it could download and records per-file problems without stopping', async () => {
      const fetchImpl = fakeGoogle((url) => {
        if (url.includes(ID_B)) return jsonResponse(404, {});
        return fileResponse([0xff, 0xd8, 0xff, url.includes(ID_A) ? 1 : 3]);
      });
      const { photos, failures } = await createDriveClient({ serviceAccount, fetchImpl }).downloadFiles([ID_A, ID_B, ID_C, ID_A]);

      expect(Object.keys(photos).sort()).toEqual([ID_A, ID_C]);
      expect(photos[ID_A][3]).toBe(1);
      expect(Object.keys(failures)).toEqual([ID_B]);
      expect(failures[ID_B].code).toBe('NO_ACCESS');
      // the repeated id was only downloaded once
      expect(fetchImpl.mock.calls.filter(([url]) => url.includes(ID_A))).toHaveLength(1);
    });

    it('stops at once when the problem would hit every file (offline, Drive API off)', async () => {
      const ids = Array.from({ length: 9 }, (_, i) => `file${String(i).padStart(8, '0')}`);
      const fetchImpl = fakeGoogle(() => jsonResponse(403, { error: { message: 'Drive API has not been used', errors: [{ reason: 'accessNotConfigured' }] } }));
      await expect(createDriveClient({ serviceAccount, fetchImpl }).downloadFiles(ids)).rejects.toMatchObject({ code: 'DRIVE_API_DISABLED' });
      // three workers at most were in flight when it hit
      expect(fetchImpl.mock.calls.filter(([url]) => !url.includes('oauth2')).length).toBeLessThanOrEqual(3);
    });

    it('limits how many photos one request may ask for', async () => {
      const ids = Array.from({ length: MAX_IDS_PER_REQUEST + 1 }, (_, i) => `file${String(i).padStart(8, '0')}`);
      await expect(createDriveClient({ serviceAccount, fetchImpl: jest.fn() }).downloadFiles(ids)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
  });

  describe('downloadDrivePhotos (config + client)', () => {
    it('says so when sync has not been set up on this laptop', async () => {
      await expect(downloadDrivePhotos({ env: {}, userDataDir: '/tmp/none', fileIds: [ID_A] })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    });

    it('uses the same configuration as the sheet sync', async () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrs-drive-'));
      fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify({ client_email: serviceAccount.clientEmail, private_key: privateKey }));
      fs.writeFileSync(path.join(dir, 'google-sync.json'), JSON.stringify({ spreadsheetId: 'sheet-1', serviceAccountKeyFile: 'key.json' }));
      const downloadFiles = jest.fn(async () => ({ photos: { [ID_A]: Buffer.from([1]) }, failures: {} }));
      const createClient = jest.fn(() => ({ downloadFiles }));

      const result = await downloadDrivePhotos({ env: {}, userDataDir: dir, fileIds: [ID_A], createClient });

      expect(createClient.mock.calls[0][0].serviceAccount.clientEmail).toBe(serviceAccount.clientEmail);
      expect(downloadFiles).toHaveBeenCalledWith([ID_A]);
      expect(result.success).toBe(true);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
