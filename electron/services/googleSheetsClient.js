// electron/services/googleSheetsClient.js
//
// Minimal, read-only Google Sheets client for the registration sync.
//
// Auth: a Google *service account* (a robot identity) that the Foundation
// shares the responses sheet with as "Viewer". The app signs a short-lived
// JWT with the service account's private key, swaps it for an access token,
// and reads the sheet through the Sheets API. Nothing is published publicly
// and no personal Google login is needed on the camp laptops.
//
// Only requests the spreadsheets.readonly scope, so even a stolen key can
// never modify the sheet.
//
// Zero dependencies: Node's built-in `crypto` and global `fetch`. This module
// must only ever be required from the Electron MAIN process — the key file
// and token never go anywhere near the renderer.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const REQUEST_TIMEOUT_MS = 20000;
const DEFAULT_SHEET_NAME = 'Form Responses 1';
const CONFIG_FILE_NAME = 'google-sync.json';

/**
 * Error with a stable `code` the UI can branch on and a message that is safe
 * to show to a nurse (never contains keys, tokens or child data).
 *
 * Codes: NOT_CONFIGURED, OFFLINE, AUTH, NO_ACCESS, NOT_FOUND, BAD_TAB,
 *        BAD_HEADERS, GOOGLE_ERROR, BUSY, INVALID_INPUT
 */
class SheetSyncError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SheetSyncError';
    this.code = code;
  }
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// Accepts either a bare spreadsheet ID or the full browser URL.
function extractSpreadsheetId(value) {
  const text = String(value ?? '').trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(text);
  return fromUrl ? fromUrl[1] : text;
}

/**
 * Resolves sync configuration. Environment variables win (handy in dev);
 * otherwise a `google-sync.json` file in the app's userData folder is used,
 * which is what each camp laptop is expected to have:
 *
 *   { "spreadsheetId": "...", "sheetName": "Form Responses 1",
 *     "serviceAccountKeyFile": "service-account.json" }
 *
 * The key file path is resolved relative to userData unless absolute.
 * Returns null when sync has not been set up on this machine.
 */
function loadSyncConfig({ env = process.env, userDataDir } = {}) {
  let fileConfig = {};
  if (userDataDir) {
    const configPath = path.join(userDataDir, CONFIG_FILE_NAME);
    if (fs.existsSync(configPath)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {
        throw new SheetSyncError(`${CONFIG_FILE_NAME} is not valid JSON. Check it for a missing quote or comma.`, 'NOT_CONFIGURED');
      }
    }
  }

  const spreadsheetId = extractSpreadsheetId(env.GOOGLE_SHEET_ID || fileConfig.spreadsheetId);
  const keyFile = env.GOOGLE_SERVICE_ACCOUNT_FILE || fileConfig.serviceAccountKeyFile;
  if (!spreadsheetId || !keyFile) return null;

  return {
    spreadsheetId,
    sheetName: String(env.GOOGLE_SHEET_TAB || fileConfig.sheetName || DEFAULT_SHEET_NAME).trim(),
    keyFilePath: path.resolve(userDataDir || process.cwd(), keyFile),
  };
}

function readServiceAccountKey(keyFilePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SheetSyncError(`The Google service-account key file was not found at ${keyFilePath}.`, 'NOT_CONFIGURED');
    }
    throw new SheetSyncError('The Google service-account key file could not be read. It should be the JSON file downloaded from Google Cloud.', 'NOT_CONFIGURED');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new SheetSyncError('The service-account key file is missing client_email or private_key. Download a fresh JSON key from Google Cloud.', 'NOT_CONFIGURED');
  }
  return { clientEmail: parsed.client_email, privateKey: parsed.private_key };
}

function signServiceAccountJwt({ clientEmail, privateKey }, nowMs, scope = READONLY_SCOPE) {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(privateKey).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

/**
 * Service-account sign-in shared by the Sheets and Drive clients: a request
 * helper that maps "no response" to the OFFLINE error, and a cached access
 * token for one read-only scope.
 *
 * @param {object}   options
 * @param {{clientEmail:string, privateKey:string}} options.serviceAccount
 * @param {string}   [options.scope]      defaults to Sheets read-only
 * @param {Function} [options.fetchImpl]  injectable for tests; defaults to global fetch
 * @param {Function} [options.now]        injectable clock; defaults to Date.now
 */
function createGoogleAuth({ serviceAccount, scope = READONLY_SCOPE, fetchImpl = globalThis.fetch, now = Date.now }) {
  let cachedToken = null; // { value, expiresAtMs }

  async function request(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      // fetch only rejects when no HTTP response was obtained: no internet,
      // DNS failure, firewall, or our timeout. That's the "offline" case.
      throw new SheetSyncError(
        "Couldn't reach Google. Check this laptop's internet connection and try again. Everything else in CHRS keeps working offline.",
        'OFFLINE'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAtMs - 60000 > now()) return cachedToken.value;

    const response = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signServiceAccountJwt(serviceAccount, now(), scope),
      }).toString(),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (body.error === 'invalid_grant') {
        throw new SheetSyncError(
          "Google rejected the service-account key. Check that this laptop's date and time are correct and that the key hasn't been deleted in Google Cloud.",
          'AUTH'
        );
      }
      throw new SheetSyncError(`Google sign-in failed (${response.status}). Check the service-account key file.`, 'AUTH');
    }

    const body = await response.json();
    cachedToken = { value: body.access_token, expiresAtMs: now() + (Number(body.expires_in) || 3600) * 1000 };
    return cachedToken.value;
  }

  const forgetToken = () => { cachedToken = null; };

  return { request, getAccessToken, forgetToken };
}

/**
 * @param {object}   options
 * @param {{clientEmail:string, privateKey:string}} options.serviceAccount
 * @param {Function} [options.fetchImpl]  injectable for tests; defaults to global fetch
 * @param {Function} [options.now]        injectable clock; defaults to Date.now
 */
function createSheetsClient({ serviceAccount, fetchImpl = globalThis.fetch, now = Date.now }) {
  const { request, getAccessToken, forgetToken } = createGoogleAuth({ serviceAccount, scope: READONLY_SCOPE, fetchImpl, now });

  /**
   * Returns the whole tab as a 2-D array (first row = headers).
   *
   * UNFORMATTED_VALUE + SERIAL_NUMBER is deliberate: dates come back as
   * locale-independent serial numbers instead of display strings like
   * "03/04/2012", which could be 3 April or 4 March depending on how the
   * spreadsheet's locale is set.
   */
  async function readSheetValues({ spreadsheetId, sheetName }) {
    const token = await getAccessToken();
    const range = `'${String(sheetName).replace(/'/g, "''")}'`;
    const url = `${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
      + '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';

    const response = await request(url, { headers: { Authorization: `Bearer ${token}` } });

    if (response.ok) {
      const body = await response.json();
      return Array.isArray(body.values) ? body.values : [];
    }

    const body = await response.json().catch(() => ({}));
    const googleMessage = String(body?.error?.message ?? '');

    if (response.status === 401) {
      forgetToken();
      throw new SheetSyncError('Google rejected the sign-in. Try again; if it keeps happening, check the service-account key.', 'AUTH');
    }
    if (response.status === 403) {
      throw new SheetSyncError(
        `This Google account can't read the sheet. Share the responses sheet with ${serviceAccount.clientEmail} as a Viewer, and make sure the Google Sheets API is enabled for the Google Cloud project.`,
        'NO_ACCESS'
      );
    }
    if (response.status === 404) {
      throw new SheetSyncError('The spreadsheet was not found. Check the spreadsheet ID in the sync configuration.', 'NOT_FOUND');
    }
    if (response.status === 400 && /unable to parse range/i.test(googleMessage)) {
      throw new SheetSyncError(`The tab "${sheetName}" does not exist in the spreadsheet. Check the tab name in the sync configuration.`, 'BAD_TAB');
    }
    throw new SheetSyncError(`Google returned an unexpected error (${response.status}). Try again in a moment.`, 'GOOGLE_ERROR');
  }

  return { getAccessToken, readSheetValues };
}

module.exports = {
  SheetSyncError,
  DEFAULT_SHEET_NAME,
  CONFIG_FILE_NAME,
  extractSpreadsheetId,
  loadSyncConfig,
  readServiceAccountKey,
  createGoogleAuth,
  createSheetsClient,
};
