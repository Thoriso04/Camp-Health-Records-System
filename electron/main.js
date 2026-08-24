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
ipcMain.handle('auth:login', async (event, { username, password }) => {
  console.log(`[Backend Auth] Login attempt for user: ${username}`);

  // TODO: Query SQLCipher DB for hashed password and compare using bcrypt
  if (username === 'admin' && password === 'password123') {
    // Basic JWT payload token generator
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        userId: 'usr-admin-01',
        username: 'admin',
        role: 'Admin',
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
      user: { userId: 'usr-admin-01', username: 'admin', role: 'Admin' },
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
    success: true,
    user: { userId: user.id, username: user.username, role: user.role, fullName: user.full_name },
  };
});