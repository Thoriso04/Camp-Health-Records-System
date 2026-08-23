const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// Imports from new folder structure
const { openEncryptedDatabase } = require('./database/database');
const { insertPatient, logAuditEvent } = require('./services/dbController');
const { verifyPassword } = require('./services/authService');
const { exportOfflineBackup } = require('./services/syncService');
const { handleIpcSafely } = require('./utils/errorHandler');

let mainWindow;
let dbInstance = null;

const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || 'dev_db_passphrase';

function initDatabase() {
  try {
    const dbPath = path.join(app.getPath('userData'), 'chrs.db');
    console.log(`[Backend DB] Initializing SQLCipher connection at: ${dbPath}`);
    dbInstance = openEncryptedDatabase(dbPath, DB_ENCRYPTION_KEY);
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

// 1. Offline CSV Patient Import
handleIpcSafely(ipcMain, 'import-patients-csv', getDb, async (event, { patientsList, userId }) => {
  const db = getDb();
  const insertTransaction = db.transaction((patients) => {
    for (const patient of patients) {
      insertPatient({ ...patient, created_by: userId });
    }
  });

  insertTransaction(patientsList);

  logAuditEvent({
    userId,
    actionType: 'IMPORT',
    targetTable: 'patients',
    targetId: null,
    beforeImage: null,
    afterImage: null,
    details: `Imported ${patientsList.length} patient records offline`
  });

  return { success: true, count: patientsList.length };
});

// 2. Encrypted USB Offline Backup Sync
handleIpcSafely(ipcMain, 'system:export-usb-backup', getDb, async (event, { usbPath }) => {
  const result = exportOfflineBackup(getDb(), usbPath);
  return { success: true, ...result };
});

// 3. User Login Authentication
handleIpcSafely(ipcMain, 'auth:login', getDb, async (event, { username, password }) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user) {
    return { success: false, message: 'Invalid credentials' };
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return { success: false, message: 'Invalid credentials' };
  }

  return {
    success: true,
    user: { userId: user.id, username: user.username, role: user.role, fullName: user.full_name },
  };
});