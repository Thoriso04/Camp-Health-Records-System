const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Imports from project modules
const { openEncryptedDatabase } = require('./database/database');
const { createAuditLogger, ACTION_TYPES } = require('./database/auditLog');
const { insertPatient, logAuditEvent } = require('./services/dbController');
const { verifyPassword } = require('./services/authService');
const { exportOfflineBackup } = require('./services/syncService');
const { listUsbDrives } = require('./services/usbDetection');
const { handleIpcSafely } = require('./utils/errorHandler');

let mainWindow;
let dbInstance = null;
let dbFilePath = null;
let auditLog = null;

const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || 'dev_db_passphrase';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_key';

function initDatabase() {
  try {
    dbFilePath = path.join(app.getPath('userData'), 'chrs.db');
    console.log(`[Backend DB] Initializing SQLCipher connection at: ${dbFilePath}`);
    dbInstance = openEncryptedDatabase(dbFilePath, DB_ENCRYPTION_KEY);
    auditLog = createAuditLogger(dbInstance);
    console.log('[Backend DB] Encrypted database initialized.');
  } catch (error) {
    console.error('[Backend DB] Database initialization failed:', error.message);
  }
}

const getDb = () => dbInstance;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Camp Health Records System (CHRS)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../build/index.html')}`;
  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================================
// SAFE IPC HANDLERS
// ============================================================================

// 1. Authentication Endpoint
ipcMain.handle('auth:login', async (event, { username, password }) => {
  console.log(`[Backend Auth] Login attempt for user: ${username}`);

  const roleByUsername = {
    admin: 'Admin',
    nurse: 'Nurse',
    physician: 'Physician',
    counselor: 'Counselor',
  };
  const role = roleByUsername[username?.toLowerCase()];

  if (role && password === 'password123') {
    const userId = `usr-${username.toLowerCase()}-01`;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        userId,
        username: username.toLowerCase(),
        role,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8, // 8 hours
      })
    ).toString('base64url');

    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const jwtToken = `${header}.${payload}.${signature}`;

    return {
      success: true,
      token: jwtToken,
      user: { userId, username: username.toLowerCase(), role },
    };
  }

  return { success: false, message: 'Invalid credentials' };
});

// 2. Tamper-Evident Audit Logging
//
// Writes a real, hash-chained row to audit_log (see electron/database/auditLog.js)
// instead of just logging to the console. Accepts either the free-text
// `action` label the existing UI components already send (e.g.
// 'USER_LOGIN', 'BACKUP_COMPLETED') or a proper `actionType` +
// `targetTable` pair for callers that have one.
handleIpcSafely(ipcMain, 'audit:log-event', getDb, async (event, logData = {}) => {
  if (!auditLog) throw new Error('Audit log is not available: database failed to initialize.');

  const entry = auditLog.logEvent({
    userId: logData.userId ?? null,
    action: logData.action ?? null,
    actionType: logData.actionType ?? null,
    targetTable: logData.targetTable ?? 'system',
    targetId: logData.targetId ?? null,
    beforeImage: logData.beforeImage ?? null,
    afterImage: logData.afterImage ?? null,
    viewDurationMs: logData.viewDurationMs ?? null,
    details: logData.details ?? null,
  });

  return { success: true, id: entry.id, hash: entry.entryHash };
});

// Reads back audit_log entries for the Audit Log Viewer, with optional
// filters by date range, user, action type, and target (e.g. a patient id).
// Restricted to VIEW_AUDIT_LOGS in the renderer via ProtectedView; the
// handler itself doesn't re-check role because the renderer has no direct
// DB access to fall back on if it did try to bypass that.
handleIpcSafely(ipcMain, 'audit:get-entries', getDb, async (event, filters = {}) => {
  if (!auditLog) throw new Error('Audit log is not available: database failed to initialize.');
  return auditLog.getEntries(filters);
});

// Walks the full hash chain and reports whether it's intact — surfaced in
// the Audit Log Viewer as an integrity check the Physician can run anytime.
handleIpcSafely(ipcMain, 'audit:verify-chain', getDb, async () => {
  if (!auditLog) throw new Error('Audit log is not available: database failed to initialize.');
  return auditLog.verifyChain();
});

// 3. Clinical Records Queries 
ipcMain.handle('patient:get-by-id', async (event, patientId) => {
  console.log(`[Backend DB] Fetching record for Patient ID: ${patientId}`);
  
  return {
    success: true,
    patientId: patientId,
  };
});

// 4. USB Backup (FR-08)
handleIpcSafely(ipcMain, 'backup:list-drives', getDb, async () => {
  return listUsbDrives();
});

handleIpcSafely(ipcMain, 'backup:start', getDb, async (event, { driveLetter, folderName, initiatedByUserId } = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  if (!driveLetter) throw new Error('No drive selected.');

  const result = await exportOfflineBackup(db, dbFilePath, driveLetter, folderName, initiatedByUserId);

  auditLog.logEvent({
    userId: initiatedByUserId ?? null,
    actionType: 'EXPORT',
    targetTable: 'backup_log',
    details: `USB backup written to ${driveLetter}${result.folderName}, sha256=${result.hash}`,
  });

  return result;
});