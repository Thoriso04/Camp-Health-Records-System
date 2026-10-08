const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
require('dotenv').config();

// Imports from project modules
const { openEncryptedDatabase } = require('./database/database');
const { createAuditLogger, ACTION_TYPES } = require('./database/auditLog');
const { insertPatient, logAuditEvent } = require('./services/dbController');
const { verifyPassword, hashPassword } = require('./services/authService');
const { exportOfflineBackup } = require('./services/syncService');
const { runGoogleSheetSync, previewGoogleSheet, getSheetSyncStatus } = require('./services/sheetSyncService');
const { SheetSyncError } = require('./services/googleSheetsClient');
const { downloadDrivePhotos } = require('./services/googleDriveClient');
const { setPatientPhoto } = require('./services/patientPhotoService');
const { previewRegistrationCsv, importRegistrationCsv } = require('./services/registrationCsvImport');
const { createPatientProfile } = require('./services/patientProfileService');
const { findPatient } = require('./services/patientQueryService');
const { listUsbDrives } = require('./services/usbDetection');
const { handleIpcSafely } = require('./utils/errorHandler');

let mainWindow;
let dbInstance = null;
let dbFilePath = null;
let auditLog = null;
let sheetSyncInProgress = false;

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
// IPC HANDLERS
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
    const normalizedUsername = username.toLowerCase();
    const databaseRoleByUsername = {
      admin: 'camp_administrator',
      nurse: 'camp_nurse',
      physician: 'camp_physician',
    };
    const db = getDb();
    if (db && databaseRoleByUsername[normalizedUsername]) {
      const existingUser = db.prepare('SELECT id, is_active FROM users WHERE username = ?').get(normalizedUsername);
      if (existingUser && !existingUser.is_active) {
        return { success: false, message: 'This account is disabled.' };
      }
      if (!existingUser) {
        const passwordHash = await hashPassword(password);
        db.prepare(`
          INSERT INTO users (username, password_hash, role, full_name)
          VALUES (?, ?, ?, ?)
        `).run(normalizedUsername, passwordHash, databaseRoleByUsername[normalizedUsername], normalizedUsername);
      }
    }

    const userId = `usr-${normalizedUsername}-01`;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        userId,
        username: normalizedUsername,
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
      user: { userId, username: normalizedUsername, role },
    };
  }

  return { success: false, message: 'Invalid credentials' };
});

// 2. Tamper-Evident Audit Logging
handleIpcSafely(ipcMain, 'audit:log-event', getDb, async (event, logData = {}) => {
  if (!auditLog) throw new Error('Audit log is not available: database failed to initialize.');

  try {
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
  } catch (err) {
    console.warn('[Audit Log Warning] Could not record log event:', err.message);
    return { success: false, error: err.message };
  }
});

// Read audit log entries
handleIpcSafely(ipcMain, 'audit:get-entries', getDb, async (event, filters = {}) => {
  if (!auditLog) throw new Error('Audit log is not available: database failed to initialize.');
  return auditLog.getEntries(filters);
});

// Verify audit chain integrity
handleIpcSafely(ipcMain, 'audit:verify-chain', getDb, async () => {
  if (!auditLog) throw new Error('Audit log is not available: database failed to initialize.');
  return auditLog.verifyChain();
});

// Google Sheet registration sync. The renderer only ever sees a summary; the
// service-account key and access token stay in this process. Expected
// failures (offline, not configured, no access...) come back as
// { success: false, code, error } rather than being thrown, so they don't
// pollute security_log the way a genuine unexpected error would.
handleIpcSafely(ipcMain, 'sheet:status', getDb, async () => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  return getSheetSyncStatus(db, { userDataDir: app.getPath('userData') });
});

// Read-only look at the sheet: what would a sync do, and which Form-uploaded
// photos on Google Drive does it need first? Writes nothing.
handleIpcSafely(ipcMain, 'sheet:preview', getDb, async (event, { campSessionDate, photoFiles } = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  try {
    return await previewGoogleSheet(db, { userDataDir: app.getPath('userData'), campSessionDate, photoFiles });
  } catch (error) {
    if (error instanceof SheetSyncError) {
      return { success: false, code: error.code, error: error.message };
    }
    throw error;
  }
});

// Downloads photos that parents uploaded through the Google Form. The
// renderer asks for a few at a time, shrinks each to a thumbnail, and passes
// the thumbnails back with the sync/import request, so full-size photos are
// never held in memory all at once and never stored.
handleIpcSafely(ipcMain, 'registration:fetch-drive-photos', getDb, async (event, { fileIds } = {}) => {
  try {
    return await downloadDrivePhotos({ userDataDir: app.getPath('userData'), fileIds });
  } catch (error) {
    if (error instanceof SheetSyncError) {
      return { success: false, code: error.code, error: error.message };
    }
    throw error;
  }
});

handleIpcSafely(ipcMain, 'sheet:sync', getDb, async (event, { importedByUserId, campSessionDate, photoFiles } = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  if (sheetSyncInProgress) {
    return { success: false, code: 'BUSY', error: 'A sync is already running. Wait for it to finish.' };
  }

  sheetSyncInProgress = true;
  try {
    return await runGoogleSheetSync(db, {
      userDataDir: app.getPath('userData'),
      syncedByUserId: importedByUserId,
      campSessionDate,
      photoFiles,
    });
  } catch (error) {
    if (error instanceof SheetSyncError) {
      return { success: false, code: error.code, error: error.message };
    }
    throw error;
  } finally {
    sheetSyncInProgress = false;
  }
});

// Registration CSV import (a CSV downloaded from the Google response sheet,
// plus optional photo files). Works fully offline. "Preview" is read-only and
// lets staff see problems (ambiguous dates, missing photos) before anything is
// written; "import" then applies exactly what the preview showed. Expected
// problems come back as { success: false, code, error }, like sheet:sync.
function handleRegistrationCsv(channel, run) {
  handleIpcSafely(ipcMain, channel, getDb, async (event, request = {}) => {
    const db = getDb();
    if (!db) throw new Error('Database is not available.');
    try {
      return run(db, request);
    } catch (error) {
      if (error instanceof SheetSyncError) {
        return { success: false, code: error.code, error: error.message };
      }
      throw error;
    }
  });
}
handleRegistrationCsv('registration:csv-preview', previewRegistrationCsv);
handleRegistrationCsv('registration:csv-import', importRegistrationCsv);

// Create a patient profile and its audit entry atomically.
handleIpcSafely(ipcMain, 'patient:create', getDb, async (event, profile = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  return createPatientProfile(db, profile);
});

// Physician adds, replaces or removes a child's photo. The role check lives in
// the service so it holds even if the button is shown by mistake.
handleIpcSafely(ipcMain, 'patient:set-photo', getDb, async (event, { patientId, photoDataUrl, userId } = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  return setPatientPhoto(db, { patientId, photoDataUrl, userId });
});

// 3. Clinical Records Queries
handleIpcSafely(ipcMain, 'patient:get-by-id', getDb, async (event, searchTerm) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  console.log(`[Backend DB] Searching for patient: ${searchTerm}`);
  return findPatient(db, searchTerm);
});

// 4. USB Backup
handleIpcSafely(ipcMain, 'backup:list-drives', getDb, async () => {
  return listUsbDrives();
});

handleIpcSafely(ipcMain, 'backup:start', getDb, async (event, { driveLetter, folderName, initiatedByUserId } = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  if (!driveLetter) throw new Error('No drive selected.');

  const result = await exportOfflineBackup(db, dbFilePath, driveLetter, folderName, initiatedByUserId);

  if (auditLog) {
    try {
      auditLog.logEvent({
        userId: initiatedByUserId ?? null,
        actionType: 'EXPORT',
        targetTable: 'backup_log',
        details: `USB backup written to ${driveLetter}${result.folderName}, sha256=${result.hash}`,
      });
    } catch (err) {
      console.warn('[Audit Log Warning] Could not log backup event:', err.message);
    }
  }

  return result;
});