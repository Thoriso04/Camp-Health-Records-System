const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Database dependencies and controllers
const { openEncryptedDatabase } = require('./database/database');
const { insertPatient, logAuditEvent } = require('./database/dbController');

let mainWindow;
let dbInstance = null;

// Access environment variables loaded from .env
const JWT_SECRET = process.env.JWT_SECRET || 'dev_fallback_secret';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || 'dev_db_passphrase';

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

// Initialize SQLCipher encrypted database connection
function initDatabase() {
  try {
    const dbPath = path.join(app.getPath('userData'), 'chrs.db');
    console.log(`[Backend DB] Initializing SQLCipher connection at: ${dbPath}`);
    dbInstance = openEncryptedDatabase(dbPath, DB_ENCRYPTION_KEY);
    console.log('✅ [Backend DB] Encrypted database connected and schema verified.');
  } catch (error) {
    console.error('❌ [Backend DB] Database initialization failed:', error.message);
  }
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
// BACKEND IPC HANDLERS
// ============================================================================

// 1. CSV Bulk Import Handler
ipcMain.handle('import-patients-csv', async (event, { patientsList, userId }) => {
  try {
    for (const patient of patientsList) {
      insertPatient({ ...patient, created_by: userId });
    }

    logAuditEvent({
      userId,
      actionType: 'IMPORT',
      targetTable: 'patients',
      targetId: null,
      beforeImage: null,
      afterImage: null,
      details: `Imported ${patientsList.length} patient records from CSV`
    });

    return { success: true, count: patientsList.length };
  } catch (error) {
    console.error('[Backend CSV Import Error]:', error.message);
    return { success: false, error: error.message };
  }
});

// 2. Authentication Endpoint
ipcMain.handle('auth:login', async (event, { username, password }) => {
  console.log(`[Backend Auth] Login attempt for user: ${username}`);

  if (username === 'admin' && password === 'password123') {
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

// 3. Tamper-Evident Audit Logging
ipcMain.handle('audit:log-event', async (event, logData) => {
  try {
    const result = logAuditEvent(logData);
    return { success: true, id: result.lastInsertRowid };
  } catch (error) {
    console.error('[Backend Audit Log Error]:', error.message);
    return { success: false, error: error.message };
  }
});

// 4. Clinical Records Queries
ipcMain.handle('patient:get-by-id', async (event, patientId) => {
  console.log(`[Backend DB] Fetching record for Patient ID: ${patientId}`);

  return {
    id: patientId,
    name: 'Alex Johnson',
    allergies: ['Penicillin', 'Peanuts'],
    diagnosis: 'Asthma',
    medicalNotes: 'Keep inhaler accessible at all times.',
  };
});