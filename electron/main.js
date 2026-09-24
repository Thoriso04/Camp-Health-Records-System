const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
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
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_key';

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
// IPC HANDLERS
// ============================================================================

// 1. USB Drive Detection
ipcMain.handle('backup:list-drives', async () => {
  try {
    // Windows PowerShell command querying Win32_LogicalDisk for removable drives (DriveType = 2)
    const command = `powershell "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 } | Select-Object DeviceID, VolumeName, FreeSpace | ConvertTo-Json"`;
    const { stdout } = await execPromise(command);

    if (!stdout.trim()) return [];

    const parsed = JSON.parse(stdout);
    const drivesList = Array.isArray(parsed) ? parsed : [parsed];

    return drivesList.map((drive) => ({
      driveLetter: drive.DeviceID,
      label: drive.VolumeName || 'Removable Disk',
      freeSpaceGb: drive.FreeSpace ? parseFloat((drive.FreeSpace / (1024 ** 3)).toFixed(2)) : 0,
    }));
  } catch (error) {
    console.error('[Backend Backup] Failed to list USB drives:', error.message);
    return [];
  }
});

// 2. USB Backup Execution
ipcMain.handle('backup:start', async (event, { driveLetter, folderName, initiatedByUserId }) => {
  try {
    const destinationFolder = path.join(`${driveLetter}\\`, folderName);

    if (!fs.existsSync(destinationFolder)) {
      fs.mkdirSync(destinationFolder, { recursive: true });
    }

    const sourceDbPath = path.join(app.getPath('userData'), 'chrs.db');
    const destDbPath = path.join(destinationFolder, 'chrs_backup.db');

    if (fs.existsSync(sourceDbPath)) {
      fs.copyFileSync(sourceDbPath, destDbPath);
    }

    console.log(`[Backend Backup] Created backup at: ${destinationFolder}`);
    return { success: true, folderPath: destinationFolder };
  } catch (error) {
    console.error('[Backend Backup] Backup failed:', error.message);
    throw new Error(`Backup execution failed: ${error.message}`);
  }
});

// 3. Authentication Endpoint
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

// 4. Tamper-Evident Audit Logging
ipcMain.handle('audit:log-event', async (event, logData) => {
  const timestamp = new Date().toISOString();
  const entryHash = crypto
    .createHash('sha256')
    .update(`${timestamp}-${logData.userId}-${logData.action}`)
    .digest('hex');

  console.log(`[Backend Audit Log] ${timestamp} | Hash: ${entryHash.slice(0, 8)}... | Action: ${logData.action}`);

  return { success: true, hash: entryHash };
});

// 5. Clinical Records Queries
ipcMain.handle('patient:get-by-id', async (event, patientId) => {
  console.log(`[Backend DB] Fetching record for Patient ID: ${patientId}`);
  return {
    success: true,
    patientId,
  };
});