const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// ---- Juané's modules (dev branch) ----
const { openEncryptedDatabase } = require('./database/database');
const { createAuditLogger } = require('./database/auditLog');
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
const FAILED_ATTEMPT_LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const getDb = () => dbInstance;

// ============================================================================
// DATABASE INIT (Juané's encrypted DB + audit logger + frontend dev seed)
// ============================================================================
function initDatabase() {
  dbFilePath = path.join(app.getPath('userData'), 'chrs.db');
  console.log(`[Backend DB] Initializing SQLCipher connection at: ${dbFilePath}`);

  try {
    dbInstance = openEncryptedDatabase(dbFilePath, DB_ENCRYPTION_KEY);
  } catch (error) {
    console.error('[Backend DB] Could not open database:', error.message);
    // DEV-ONLY: set aside an unreadable old file (never delete it) and start fresh.
    if (!app.isPackaged) {
      try {
        for (const suffix of ['', '-wal', '-shm']) {
          const p = dbFilePath + suffix;
          if (fs.existsSync(p)) fs.renameSync(p, `${p}.old-${Date.now()}`);
        }
        dbInstance = openEncryptedDatabase(dbFilePath, DB_ENCRYPTION_KEY);
      } catch (retryError) {
        console.error('[Backend DB] Database initialization failed:', retryError.message);
        return;
      }
    } else {
      return;
    }
  }

  auditLog = createAuditLogger(dbInstance);
  seedDevAccounts();
  console.log('[Backend DB] Encrypted database initialized.');
}

// DEV-ONLY: pre-approved test accounts (password: password123). REMOVE before
// real camper data is used - real accounts must go through register + approve.
function seedDevAccounts() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;
  const seed = [
    { username: 'admin', role: 'camp_administrator', fullName: 'Default Admin' },
    { username: 'physician', role: 'camp_physician', fullName: 'Default Physician' },
    { username: 'nurse', role: 'camp_nurse', fullName: 'Default Nurse' },
    { username: 'paramedic', role: 'paramedic', fullName: 'Default Paramedic' },
  ];
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, role, full_name, is_active) VALUES (?, ?, ?, ?, 1)'
  );
  const hash = bcrypt.hashSync('password123', 12);
  for (const a of seed) insert.run(a.username, hash, a.role, a.fullName);
  console.log('[Backend DB] Seeded 4 dev accounts (admin, physician, nurse, paramedic / password123). REMOVE before real use.');
}

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
// AUTH: register -> admin approves -> login   (frontend branch)
// ============================================================================
// DB role names (schema CHECK constraint) -> frontend Role type.
const DB_ROLE_TO_FRONTEND_ROLE = {
  camp_administrator: 'Admin',
  camp_physician: 'Physician',
  camp_nurse: 'Nurse',
  paramedic: 'Counselor',
};

ipcMain.handle('auth:register', async (event, { fullName, username, password, requestedRole } = {}) => {
  const db = getDb();
  if (!db) return { success: false, message: 'Database is not available.' };
  if (!fullName || !username || !password || !requestedRole) {
    return { success: false, message: 'All fields are required.' };
  }
  if (password.length < 8) {
    return { success: false, message: 'Password must be at least 8 characters.' };
  }
  const uname = String(username).trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(uname)) {
    return { success: false, message: 'That username is already taken.' };
  }
  const passwordHash = bcrypt.hashSync(password, 12);
  try {
    db.prepare(
      'INSERT INTO users (username, password_hash, role, full_name, is_active) VALUES (?, ?, ?, ?, 0)'
    ).run(uname, passwordHash, requestedRole, fullName);
  } catch (err) {
    return { success: false, message: `Could not register: ${err.message}` };
  }
  console.log(`[Backend Auth] Registration pending approval: ${uname}`);
  return { success: true, pending: true };
});

ipcMain.handle('auth:login', async (event, { username, password } = {}) => {
  const db = getDb();
  if (!db) return { success: false, message: 'Database is not available.' };

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
  if (!row) return { success: false, message: 'Invalid credentials' };

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    return { success: false, message: 'This account is temporarily locked due to repeated failed attempts. Try again later.' };
  }
  if (!row.is_active) {
    return { success: false, message: 'This account is pending approval from an Administrator.' };
  }

  if (!bcrypt.compareSync(password || '', row.password_hash)) {
    const failed = (row.failed_attempts || 0) + 1;
    const lock = failed >= FAILED_ATTEMPT_LOCKOUT_THRESHOLD;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
      failed,
      lock ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString() : null,
      row.id
    );
    return { success: false, message: 'Invalid credentials' };
  }

  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(row.id);

  const role = DB_ROLE_TO_FRONTEND_ROLE[row.role] || row.role;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId: String(row.id),
      username: row.username,
      role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');

  if (auditLog) {
    try {
      auditLog.logEvent({ userId: row.id, actionType: 'LOGIN', targetTable: 'users', targetId: row.id, details: 'User login' });
    } catch (err) {
      console.warn('[Audit Log Warning] Could not log login:', err.message);
    }
  }

  return {
    success: true,
    token: `${header}.${payload}.${signature}`,
    user: { userId: String(row.id), username: row.username, role },
  };
});

// NOTE: gated in the UI only (MANAGE_USERS). Re-check the caller's role here
// before production - a renderer can be tampered with.
ipcMain.handle('user:list-pending', async () => {
  const db = getDb();
  if (!db) return [];
  return db.prepare('SELECT id, username, full_name, role, created_at FROM users WHERE is_active = 0').all();
});

ipcMain.handle('user:approve', async (event, { userId } = {}) => {
  const db = getDb();
  if (!db) return { success: false };
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(userId);
  return { success: true };
});

// ============================================================================
// CLINICAL FORMS - saved as append-only JSON records (no update/delete handler,
// so a filed form cannot be edited). Camper forms and staff/crew forms live in
// SEPARATE tables, as the spec requires staff records to be stored apart.
// ============================================================================
function ensureFormTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS camper_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_type TEXT NOT NULL,
      patient_ref TEXT,
      subject_name TEXT,
      payload TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS staff_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_type TEXT NOT NULL,
      subject_name TEXT,
      payload TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function registerFormSaver(channel, table, formType, pick) {
  ipcMain.handle(channel, async (event, data = {}) => {
    const db = getDb();
    if (!db) return { success: false, message: 'Database is not available.' };
    try {
      ensureFormTables(db);
      const { patientRef, subjectName, createdBy } = pick(data);
      const payload = JSON.stringify(data);
      if (table === 'camper_forms') {
        db.prepare('INSERT INTO camper_forms (form_type, patient_ref, subject_name, payload, created_by) VALUES (?,?,?,?,?)')
          .run(formType, patientRef == null ? null : String(patientRef), subjectName ?? null, payload, createdBy == null ? null : String(createdBy));
      } else {
        db.prepare('INSERT INTO staff_forms (form_type, subject_name, payload, created_by) VALUES (?,?,?,?)')
          .run(formType, subjectName ?? null, payload, createdBy == null ? null : String(createdBy));
      }
      return { success: true };
    } catch (err) {
      console.error(`[Backend Forms] ${channel} failed:`, err.message);
      return { success: false, message: 'Could not save this form.' };
    }
  });
}

registerFormSaver('medication:save-checkin', 'camper_forms', 'medication_checkin',
  (d) => ({ patientRef: d.patientId, subjectName: d.patientName ?? d.name, createdBy: d.recordedByUserId ?? d.createdByUserId }));
registerFormSaver('medshack:save-visit', 'camper_forms', 'medshack_visit',
  (d) => ({ patientRef: d.patientId, subjectName: d.patientName, createdBy: d.recordedByUserId }));
registerFormSaver('incident:save-report', 'camper_forms', 'incident_report',
  (d) => ({ patientRef: null, subjectName: d.camperName, createdBy: d.filedByUserId }));
registerFormSaver('staff:save-checkin', 'staff_forms', 'staff_checkin',
  (d) => ({ subjectName: d.name, createdBy: d.recordedByUserId }));
registerFormSaver('crewindemnity:save', 'staff_forms', 'crew_indemnity',
  (d) => ({ subjectName: d.fullName, createdBy: d.recordedByUserId }));


// ============================================================================
// MEDICATION & TREATMENT LOG (weekly administration table + missed-dose alerts)
// Tables are created here with IF NOT EXISTS so no migration is needed.
// ============================================================================
function ensureMedLogTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS med_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      medication TEXT NOT NULL,
      dose TEXT,
      times TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS med_administration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES med_schedule(id),
      patient_id INTEGER NOT NULL,
      dose_date TEXT NOT NULL,
      dose_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('given','refused')),
      note TEXT,
      administered_by TEXT,
      administered_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (schedule_id, dose_date, dose_time)
    );
  `);
}

ipcMain.handle('medlog:get', async (event, { patientId, from, to } = {}) => {
  const db = getDb();
  if (!db) return { success: false, message: 'Database is not available.' };
  ensureMedLogTables(db);
  const schedules = db.prepare('SELECT id, medication, dose, times FROM med_schedule WHERE patient_id = ? ORDER BY id').all(patientId)
    .map((r) => ({ ...r, times: JSON.parse(r.times) }));
  const records = db.prepare(
    `SELECT a.schedule_id, a.dose_date, a.dose_time, a.status, a.note, u.username AS administered_by
       FROM med_administration a LEFT JOIN users u ON CAST(u.id AS TEXT) = a.administered_by
      WHERE a.patient_id = ? AND a.dose_date BETWEEN ? AND ?`
  ).all(patientId, from, to);
  return { success: true, schedules, records };
});

ipcMain.handle('medlog:add-schedule', async (event, { patientId, medication, dose, times, userId } = {}) => {
  const db = getDb();
  if (!db) return { success: false, message: 'Database is not available.' };
  if (!medication || !Array.isArray(times) || times.length === 0) return { success: false, message: 'Medication and at least one time are required.' };
  ensureMedLogTables(db);
  db.prepare('INSERT INTO med_schedule (patient_id, medication, dose, times, created_by) VALUES (?,?,?,?,?)')
    .run(patientId, medication, dose ?? null, JSON.stringify([...new Set(times)].sort().slice(0, 4)), String(userId ?? ''));
  return { success: true };
});

// Recorded doses are append-only (UNIQUE constraint rejects a second write).
ipcMain.handle('medlog:record', async (event, { scheduleId, patientId, date, time, status, note, userId } = {}) => {
  const db = getDb();
  if (!db) return { success: false, message: 'Database is not available.' };
  if (!['given', 'refused'].includes(status)) return { success: false, message: 'Invalid status.' };
  ensureMedLogTables(db);
  try {
    db.prepare('INSERT INTO med_administration (schedule_id, patient_id, dose_date, dose_time, status, note, administered_by) VALUES (?,?,?,?,?,?,?)')
      .run(scheduleId, patientId, date, time, status, note ?? null, String(userId ?? ''));
    return { success: true };
  } catch (err) {
    return { success: false, message: String(err.message).includes('UNIQUE') ? 'That dose has already been recorded.' : err.message };
  }
});

// All doses scheduled for today that are not recorded yet (client decides which are overdue).
ipcMain.handle('medlog:today', async (event, { date } = {}) => {
  const db = getDb();
  if (!db) return { success: true, doses: [] };
  ensureMedLogTables(db);
  const rows = db.prepare(
    `SELECT s.id AS schedule_id, s.medication, s.times, p.id AS patient_id, p.first_name, p.last_name
       FROM med_schedule s JOIN patients p ON p.id = s.patient_id`
  ).all();
  const done = new Set(db.prepare('SELECT schedule_id, dose_time FROM med_administration WHERE dose_date = ?').all(date).map((r) => `${r.schedule_id}|${r.dose_time}`));
  const doses = [];
  for (const r of rows) for (const t of JSON.parse(r.times)) {
    if (!done.has(`${r.schedule_id}|${t}`)) doses.push({ scheduleId: r.schedule_id, medication: r.medication, time: t, patientId: r.patient_id, patientName: `${r.first_name} ${r.last_name}` });
  }
  return { success: true, doses };
});

// ============================================================================
// AUDIT (Juané)
// ============================================================================
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

handleIpcSafely(ipcMain, 'audit:get-entries', getDb, async (event, filters = {}) => {
  if (!auditLog) throw new Error('Audit log is not available: database failed to initialize.');
  return auditLog.getEntries(filters);
});

handleIpcSafely(ipcMain, 'audit:verify-chain', getDb, async () => {
  if (!auditLog) throw new Error('Audit log is not available: database failed to initialize.');
  return auditLog.verifyChain();
});

// ============================================================================
// GOOGLE SHEET SYNC + REGISTRATION CSV (Juané)
// ============================================================================
handleIpcSafely(ipcMain, 'sheet:status', getDb, async () => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  return getSheetSyncStatus(db, { userDataDir: app.getPath('userData') });
});

handleIpcSafely(ipcMain, 'sheet:preview', getDb, async (event, { campSessionDate, photoFiles } = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  try {
    return await previewGoogleSheet(db, { userDataDir: app.getPath('userData'), campSessionDate, photoFiles });
  } catch (error) {
    if (error instanceof SheetSyncError) return { success: false, code: error.code, error: error.message };
    throw error;
  }
});

handleIpcSafely(ipcMain, 'registration:fetch-drive-photos', getDb, async (event, { fileIds } = {}) => {
  try {
    return await downloadDrivePhotos({ userDataDir: app.getPath('userData'), fileIds });
  } catch (error) {
    if (error instanceof SheetSyncError) return { success: false, code: error.code, error: error.message };
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
    if (error instanceof SheetSyncError) return { success: false, code: error.code, error: error.message };
    throw error;
  } finally {
    sheetSyncInProgress = false;
  }
});

function handleRegistrationCsv(channel, run) {
  handleIpcSafely(ipcMain, channel, getDb, async (event, request = {}) => {
    const db = getDb();
    if (!db) throw new Error('Database is not available.');
    try {
      return run(db, request);
    } catch (error) {
      if (error instanceof SheetSyncError) return { success: false, code: error.code, error: error.message };
      throw error;
    }
  });
}
handleRegistrationCsv('registration:csv-preview', previewRegistrationCsv);
handleRegistrationCsv('registration:csv-import', importRegistrationCsv);

// ============================================================================
// PATIENTS (Juané)
// ============================================================================
handleIpcSafely(ipcMain, 'patient:create', getDb, async (event, profile = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  return createPatientProfile(db, profile);
});

handleIpcSafely(ipcMain, 'patient:set-photo', getDb, async (event, { patientId, photoDataUrl, userId } = {}) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  return setPatientPhoto(db, { patientId, photoDataUrl, userId });
});

handleIpcSafely(ipcMain, 'patient:get-by-id', getDb, async (event, searchTerm) => {
  const db = getDb();
  if (!db) throw new Error('Database is not available.');
  console.log(`[Backend DB] Searching for patient: ${searchTerm}`);
  return findPatient(db, searchTerm);
});

// ============================================================================
// USB BACKUP (Juané)
// ============================================================================
handleIpcSafely(ipcMain, 'backup:list-drives', getDb, async () => listUsbDrives());

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