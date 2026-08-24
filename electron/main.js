const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

let mainWindow;

// Access environment variables loaded from .env
const JWT_SECRET = process.env.JWT_SECRET || 'dev_fallback_secret';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || 'dev_db_passphrase';

// Cryptographic key buffer check
const keyBuffer = Buffer.from(DB_ENCRYPTION_KEY, 'utf-8');

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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================================
// BACKEND IPC HANDLERS & DATABASE INIT
// ============================================================================

/**
 * TODO: Initialize SQLCipher / better-sqlite3 instance here.
 * Execute PRAGMA key = '${DB_ENCRYPTION_KEY}' upon opening database connection.
 */
function initDatabase() {
  console.log(`[Backend DB] Initializing SQLite connection using key length: ${keyBuffer.length} bytes`);
  // SQLCipher database initialization logic goes here
}

initDatabase();

// 1. Authentication Endpoint
// TEST_ACCOUNTS lets you log in as any of the 4 roles during dev.
// Test password for all: password123
const TEST_ACCOUNTS = {
  admin: { userId: 'usr-admin-01', role: 'Admin' },
  physician: { userId: 'usr-physician-01', role: 'Physician' },
  nurse: { userId: 'usr-nurse-01', role: 'Nurse' },
  counselor: { userId: 'usr-counselor-01', role: 'Counselor' },
};

ipcMain.handle('auth:login', async (event, { username, password }) => {
  console.log(`[Backend Auth] Login attempt for user: ${username}`);

  // TODO: Query SQLCipher DB for hashed password and compare using bcrypt
  const account = TEST_ACCOUNTS[username];
  if (account && password === 'password123') {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        userId: account.userId,
        username,
        role: account.role,
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
      user: { userId: account.userId, username, role: account.role },
    };
  }

  return { success: false, message: 'Invalid credentials' };
});

// 2. Tamper-Evident Audit Logging
ipcMain.handle('audit:log-event', async (event, logData) => {
  const timestamp = new Date().toISOString();
  const entryHash = crypto
    .createHash('sha256')
    .update(`${timestamp}-${logData.userId}-${logData.action}`)
    .digest('hex');

  console.log(`[Backend Audit Log] ${timestamp} | Hash: ${entryHash.slice(0, 8)}... | Action: ${logData.action}`);

  // TODO: INSERT INTO audit_logs (id, timestamp, user_id, action, hash) VALUES (...)
  return { success: true, hash: entryHash };
});

// 3. Clinical Records Queries
ipcMain.handle('patient:get-by-id', async (event, patientId) => {
  console.log(`[Backend DB] Fetching record for Patient ID: ${patientId}`);

  // TODO: SELECT * FROM campers WHERE camper_id = patientId
  return {
    id: patientId,
    name: 'Alex Johnson',
    allergies: ['Penicillin', 'Peanuts'],
    diagnosis: 'Asthma',
    medicalNotes: 'Keep inhaler accessible at all times.',
  };
});