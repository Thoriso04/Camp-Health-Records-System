const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

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

  // Load React app (dist/index.html in production or dev server in development)
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
// IPC HANDLERS (Database, Auth, Audit Logging)
// ============================================================================

/**
 * TODO: Initialize SQLCipher / better-sqlite3 database instance here.
 * Load encryption key securely from process.env.DB_ENCRYPTION_KEY
 */

// Authentication IPC Handler
ipcMain.handle('auth:login', async (event, { username, password }) => {
  console.log(`[IPC] Login attempt for user: ${username}`);
  
  // TODO (Itumeleng): Replace mock validation with DB user lookup & bcrypt verification
  if (username === 'admin' && password === 'password123') {
    return {
      success: true,
      token: 'mock-jwt-token-for-dev',
      user: { userId: 'usr-001', username: 'admin', role: 'Admin' }
    };
  }

  return { success: false, message: 'Invalid credentials' };
});

// Patient & Clinical Record IPC Handler
ipcMain.handle('patient:get-by-id', async (event, patientId) => {
  console.log(`[IPC] Fetching patient record: ${patientId}`);
  
  // TODO: Connect query to local SQLite database
  return {
    id: patientId,
    name: 'Alex Johnson',
    allergies: ['Penicillin', 'Peanuts'],
    diagnosis: 'Type 1 Diabetes',
    medicalNotes: 'Requires insulin check before meals.'
  };
});

// TODO: Add IPC handler for Audit Log persistence
ipcMain.handle('audit:log-event', async (event, logEntry) => {
  console.log('[IPC Audit Log]', logEntry);
  return { success: true };
});