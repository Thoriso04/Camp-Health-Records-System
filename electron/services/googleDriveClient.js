// electron/services/googleDriveClient.js
//
// Downloads the photos parents upload through the Google Form's "file upload"
// question. Google stores each upload in the Drive of whoever owns the Form
// and writes a link such as https://drive.google.com/open?id=<fileId> into the
// response sheet. This client turns those file IDs into image bytes.
//
// Auth is the same service account the Sheet sync uses, with the read-only
// Drive scope. It can only see files that were shared with it: share the Form's
// upload folder ("<Form name> (File responses)") with the service account's
// e-mail address as a Viewer. Files that land in that folder afterwards inherit
// the sharing, so this is a one-off step. See docs/GOOGLE_SHEET_SYNC.md.
//
// Like googleSheetsClient.js, this runs only in the Electron MAIN process and
// has no dependencies. It never writes to Drive.

const {
  SheetSyncError,
  loadSyncConfig,
  readServiceAccountKey,
  createGoogleAuth,
} = require('./googleSheetsClient');

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

// A phone photo is a few MB. Anything near this size is not a photo of a child.
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_IDS_PER_REQUEST = 10;
const CONCURRENCY = 3;
const FILE_ID = /^[A-Za-z0-9_-]{10,}$/;

// Codes that mean "every download will fail the same way", so there is no
// point trying the remaining files.
const SYSTEMIC_CODES = new Set(['OFFLINE', 'AUTH', 'DRIVE_API_DISABLED']);

/**
 * @param {object}   options
 * @param {{clientEmail:string, privateKey:string}} options.serviceAccount
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.now]
 */
function createDriveClient({ serviceAccount, fetchImpl = globalThis.fetch, now = Date.now }) {
  const { request, getAccessToken, forgetToken } = createGoogleAuth({
    serviceAccount, scope: DRIVE_READONLY_SCOPE, fetchImpl, now,
  });

  /** @returns {Promise<Buffer>} the file's bytes */
  async function downloadFile(fileId) {
    if (!FILE_ID.test(String(fileId))) throw new SheetSyncError('That is not a valid Google Drive file ID.', 'INVALID_INPUT');
    const token = await getAccessToken();
    const url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    const response = await request(url, { headers: { Authorization: `Bearer ${token}` } });

    if (response.ok) {
      const declared = Number(response.headers?.get?.('content-length'));
      if (declared > MAX_DOWNLOAD_BYTES) {
        throw new SheetSyncError(`The photo is too large (${Math.round(declared / 1048576)} MB).`, 'TOO_LARGE');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_DOWNLOAD_BYTES) {
        throw new SheetSyncError(`The photo is too large (${Math.round(bytes.length / 1048576)} MB).`, 'TOO_LARGE');
      }
      return bytes;
    }

    const body = await response.json().catch(() => ({}));
    const googleMessage = String(body?.error?.message ?? '');
    const reasons = (body?.error?.errors ?? []).map((item) => item?.reason);

    if (response.status === 401) {
      forgetToken();
      throw new SheetSyncError('Google rejected the sign-in while downloading photos. Try again.', 'AUTH');
    }
    if (response.status === 403 && (reasons.includes('accessNotConfigured') || /has not been used|is disabled/i.test(googleMessage))) {
      throw new SheetSyncError(
        'The Google Drive API is not switched on for the Google Cloud project. In Google Cloud Console open APIs & Services > Library, search for "Google Drive API" and press Enable.',
        'DRIVE_API_DISABLED'
      );
    }
    if (response.status === 403 && /rate|quota/i.test(`${googleMessage} ${reasons.join(' ')}`)) {
      throw new SheetSyncError('Google is limiting downloads right now. Wait a minute and try again.', 'GOOGLE_ERROR');
    }
    // Drive answers 404 for a file that exists but isn't shared with the caller.
    if (response.status === 404 || response.status === 403) {
      throw new SheetSyncError(
        `The photo was not found, or it is not shared with ${serviceAccount.clientEmail}. Share the Form's upload folder with that address as a Viewer.`,
        'NO_ACCESS'
      );
    }
    throw new SheetSyncError(`Google returned an unexpected error (${response.status}) while downloading a photo.`, 'GOOGLE_ERROR');
  }

  /**
   * Downloads several photos. A problem with one file (deleted, too large) is
   * recorded in `failures` and the rest carry on; a problem that would hit
   * every file (offline, bad key, Drive API off) is thrown.
   * @returns {Promise<{ photos: Record<string, Buffer>, failures: Record<string, { code: string, message: string }> }>}
   */
  async function downloadFiles(fileIds) {
    const ids = [...new Set((Array.isArray(fileIds) ? fileIds : []).map(String))];
    if (ids.length > MAX_IDS_PER_REQUEST) {
      throw new SheetSyncError(`Download at most ${MAX_IDS_PER_REQUEST} photos at a time.`, 'INVALID_INPUT');
    }
    const photos = {};
    const failures = {};
    let fatal = null;
    let next = 0;

    async function worker() {
      while (!fatal && next < ids.length) {
        const id = ids[next++];
        try {
          photos[id] = await downloadFile(id);
        } catch (error) {
          if (!(error instanceof SheetSyncError)) throw error;
          if (SYSTEMIC_CODES.has(error.code)) { fatal = error; return; }
          failures[id] = { code: error.code, message: error.message };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    if (fatal) throw fatal;
    return { photos, failures };
  }

  return { downloadFile, downloadFiles };
}

/**
 * Entry point for the IPC handler: loads this laptop's sync configuration (the
 * same google-sync.json the Sheet sync uses) and downloads the given photos.
 * `createClient` is injectable so the flow can be tested without Google.
 * @returns {Promise<{ success: true, photos: Record<string, Buffer>, failures: Record<string, { code: string, message: string }> }>}
 */
async function downloadDrivePhotos({ userDataDir, env = process.env, fileIds, createClient = createDriveClient } = {}) {
  const config = loadSyncConfig({ env, userDataDir });
  if (!config) {
    throw new SheetSyncError(
      'Google sync has not been set up on this laptop yet, so photos cannot be downloaded from Google Drive. See docs/GOOGLE_SHEET_SYNC.md (section "Set up a laptop").',
      'NOT_CONFIGURED'
    );
  }
  const client = createClient({ serviceAccount: readServiceAccountKey(config.keyFilePath) });
  const { photos, failures } = await client.downloadFiles(fileIds);
  return { success: true, photos, failures };
}

module.exports = {
  DRIVE_READONLY_SCOPE,
  downloadDrivePhotos,
  MAX_IDS_PER_REQUEST,
  MAX_DOWNLOAD_BYTES,
  createDriveClient,
};
