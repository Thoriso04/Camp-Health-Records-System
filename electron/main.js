const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { openEncryptedDatabase } = require('./database/database');
const { createPatientRepository } = require('./database/patientRepository');
require('dotenv').config();

let mainWindow;
let db;
let patientRepository;

const JWT_SECRET = process.env.JWT_SECRET || 'dev_fallback_secret';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || 'dev_db_passphrase';
const FAILED_ATTEMPT_LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

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
// DATABASE INIT
// ============================================================================

/**
 * Opens the encrypted SQLite DB, applies the SQLCipher key, and runs
 * Juané's schema.sql (electron/database/schema.sql). Seeds ONE default
 * admin account if the users table is empty, so there's always a way
 * to log in and approve the first real registrations.
 *
 * SECURITY NOTE: this seeded account uses a well-known password. This
 * is fine for local dev, but MUST be changed (or the account disabled)
 * before this is ever used with real camper data. Consider forcing a
 * password change on first login as a follow-up.
 */
function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'chrs.db');

  try {
    db = openEncryptedDatabase(dbPath, DB_ENCRYPTION_KEY);
  } catch (err) {
    // DEV-ONLY SAFETY NET: if the existing file can't be opened with the
    // current key/cipher settings (e.g. a leftover file from before this
    // module was wired in), delete it and start fresh rather than
    // crashing every time. This must NOT ship this way in production —
    // it would silently destroy real camper data on a key mismatch.
    console.warn('[Backend DB] Could not open existing database (', err.message, ') - recreating for dev.');
    const fs = require('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    db = openEncryptedDatabase(dbPath, DB_ENCRYPTION_KEY);
  }

  patientRepository = createPatientRepository(db);

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    // Seeded, pre-approved (is_active = 1) test accounts, one per DB
    // role, so you can still quickly test every role during dev
    // without registering + approving each one by hand every time the
    // dev database gets wiped. All use password: password123
    //
    // These are DEV-ONLY. Before this touches real camper data, this
    // whole seeding block should be removed, and real accounts should
    // go through registration + approval only.
    const seedAccounts = [
      { username: 'admin', role: 'camp_administrator', fullName: 'Default Admin' },
      { username: 'physician', role: 'camp_physician', fullName: 'Default Physician' },
      { username: 'nurse', role: 'camp_nurse', fullName: 'Default Nurse' },
      { username: 'paramedic', role: 'paramedic', fullName: 'Default Paramedic' },
    ];
    const insertUser = db.prepare(
      `INSERT INTO users (username, password_hash, role, full_name, is_active) VALUES (?, ?, ?, ?, 1)`
    );
    const hash = bcrypt.hashSync('password123', 12);
    for (const acc of seedAccounts) {
      insertUser.run(acc.username, hash, acc.role, acc.fullName);
    }
    console.log('[Backend DB] Seeded 4 pre-approved dev test accounts (admin, physician, nurse, paramedic / password123). REMOVE before real use.');
  }

  console.log(`[Backend DB] Database ready at ${dbPath}`);
}

// ============================================================================
// AUTH: REGISTER, LOGIN
// ============================================================================

// Maps the DB's role strings (matching Juané's schema CHECK constraint)
// to the frontend's Role type (types/auth.ts). These are DIFFERENT
// naming schemes that both exist in the codebase right now — worth
// unifying with the team rather than adding a 5th variant.
const DB_ROLE_TO_FRONTEND_ROLE = {
  camp_administrator: 'Admin',
  camp_physician: 'Physician',
  camp_nurse: 'Nurse',
  paramedic: 'Counselor', // no direct match yet - closest existing frontend role
};

ipcMain.handle('auth:register', async (event, { fullName, username, password, requestedRole }) => {
  console.log(`[Backend Auth] Registration attempt for user: ${username}, requested role: ${requestedRole}`);

  if (!fullName || !username || !password || !requestedRole) {
    return { success: false, message: 'All fields are required.' };
  }
  if (password.length < 8) {
    return { success: false, message: 'Password must be at least 8 characters.' };
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return { success: false, message: 'That username is already taken.' };
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare(
    `INSERT INTO users (username, password_hash, role, full_name, is_active) VALUES (?, ?, ?, ?, 0)`
  ).run(username, passwordHash, requestedRole, fullName);

  console.log(`[Backend Audit Log] Registration pending approval: ${username}`);
  return { success: true, pending: true };
});

ipcMain.handle('auth:login', async (event, { username, password }) => {
  console.log(`[Backend Auth] Login attempt for user: ${username}`);

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) {
    return { success: false, message: 'Invalid credentials' };
  }

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    return { success: false, message: 'This account is temporarily locked due to repeated failed attempts. Try again later.' };
  }

  if (!row.is_active) {
    return { success: false, message: 'This account is pending approval from an Administrator.' };
  }

  const passwordMatches = bcrypt.compareSync(password, row.password_hash);
  if (!passwordMatches) {
    const newFailedAttempts = row.failed_attempts + 1;
    const shouldLock = newFailedAttempts >= FAILED_ATTEMPT_LOCKOUT_THRESHOLD;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
      newFailedAttempts,
      shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString() : null,
      row.id
    );
    return { success: false, message: 'Invalid credentials' };
  }

  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(row.id);

  const frontendRole = DB_ROLE_TO_FRONTEND_ROLE[row.role] || row.role;

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId: String(row.id),
      username: row.username,
      role: frontendRole,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  const jwtToken = `${header}.${payload}.${signature}`;

  return {
    success: true,
    token: jwtToken,
    user: { userId: String(row.id), username: row.username, role: frontendRole },
  };
});

// ============================================================================
// USER MANAGEMENT: pending approvals
// NOTE: gated client-side only (ProtectedView requiredPermission=MANAGE_USERS).
// This handler does NOT independently verify the caller's role/permission
// server-side — it trusts the renderer. That's a real gap worth closing
// before this goes anywhere near production: an Electron renderer can be
// tampered with, so authorization decisions should ideally be re-checked
// here too, not just in the UI.
// ============================================================================

ipcMain.handle('user:list-pending', async () => {
  return db.prepare('SELECT id, username, full_name, role, created_at FROM users WHERE is_active = 0').all();
});

ipcMain.handle('user:approve', async (event, { userId }) => {
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(userId);
  return { success: true };
});

// ============================================================================
// OTHER BACKEND IPC HANDLERS
// ============================================================================

ipcMain.handle('audit:log-event', async (event, logData) => {
  const timestamp = new Date().toISOString();
  const entryHash = crypto
    .createHash('sha256')
    .update(`${timestamp}-${logData.userId}-${logData.action}`)
    .digest('hex');

  console.log(`[Backend Audit Log] ${timestamp} | Hash: ${entryHash.slice(0, 8)}... | Action: ${logData.action}`);

  // TODO: INSERT INTO audit_log (...) - the real audit_log table already
  // exists per schema.sql, this just needs to actually write to it.
  return { success: true, hash: entryHash };
});

ipcMain.handle('patient:get-by-id', async (event, patientId) => {
  console.log(`[Backend DB] Fetching record for Patient ID: ${patientId}`);
  const row = patientRepository.getPatient(patientId);
  if (!row) return null;
  return {
    id: String(row.id),
    name: `${row.first_name} ${row.last_name}`,
    dateOfBirth: row.date_of_birth,
    allergies: row.known_allergies ? row.known_allergies.split(',').map((a) => a.trim()).filter(Boolean) : [],
    diagnosis: row.primary_diagnosis,
    medicalNotes: row.medical_notes,
  };
});

// NOTE: the `patients` table (schema.sql) only has the core fields
// below. NewPatientProfile.tsx's Camper Check-In form now collects far
// more — parent/caregiver contacts, clinical review (viral load/TB/Hep
// B), accessibility fields, and signed indemnity/consent. None of that
// has anywhere to go yet; this schema needs new tables/columns before
// the real form data can be saved in full. This handler only persists
// the subset that already fits, so registration/patient search work
// end-to-end, but it is NOT capturing everything the real form collects.
ipcMain.handle('patient:create', async (event, payload) => {
  const { patient, elapsedMs } = patientRepository.createPatient(
    {
      firstName: payload.firstName,
      lastName: payload.surname,
      dateOfBirth: payload.dateOfBirth,
      primaryDiagnosis: payload.diagnosis || '',
      knownAllergies: Array.isArray(payload.allergies) ? payload.allergies.join(', ') : '',
      medicalNotes: payload.additionalDisclosures || payload.behavioralNotes || null,
      campSessionDate: payload.campSessionDate,
    },
    payload.createdByUserId
  );
  console.log(`[Backend DB] Patient created in ${elapsedMs.toFixed(1)}ms`);
  return { id: String(patient.id) };
});