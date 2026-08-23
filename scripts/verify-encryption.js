// scripts/verify-encryption.js
//
// Run with: node scripts/verify-encryption.js
//
// Checks the two acceptance criteria that are easy to silently get wrong:
//   1. "Database file unreadable when opened in standard text/database editors"
//   2. "Transaction processing completes under 500 ms"
//
// This is a standalone smoke test, not a replacement for the Jest suite.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { openEncryptedDatabase } = require('../electron/database/database');
const { createPatientRepository } = require('../electron/database/patientRepository');

const testDbPath = path.join(os.tmpdir(), `chrs-verify-${Date.now()}.db`);
const testKey = 'correct-horse-battery-staple-DO-NOT-USE-IN-PROD';

console.log('Test DB:', testDbPath);

const db = openEncryptedDatabase(testDbPath, testKey);
const patients = createPatientRepository(db);

// --- Criterion 1: file is not readable as plaintext SQLite -------------
const header = fs.readFileSync(testDbPath).subarray(0, 16).toString('utf8');
const isPlaintextSqlite = header.startsWith('SQLite format 3');
console.log(
    isPlaintextSqlite
        ? 'FAIL: file header is plaintext SQLite — encryption is NOT active'
        : 'PASS: file header is not a recognisable SQLite header (encrypted)'
);

try {
    // eslint-disable-next-line global-require
    const PlainDatabase = require('better-sqlite3'); // stock, no cipher support
    const plain = new PlainDatabase(testDbPath, { fileMustExist: true });
    plain.prepare('SELECT * FROM patients LIMIT 1').get();
    console.log('FAIL: a stock (non-cipher) SQLite driver could read the database');
} catch (err) {
    console.log('PASS: stock SQLite driver cannot read the file ->', err.message);
}

// --- Set up a dummy user so the NOT NULL / FK on patients.created_by is satisfied ---
// (In real use, this is always a logged-in user's id — never null.)
const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name)
    VALUES (?, ?, ?, ?)
`);
const testUserId = insertUser.run(
    'verify_script_user',
    'not-a-real-hash',
    'camp_physician',
    'Verification Script'
).lastInsertRowid;

// --- Criterion 2: transaction under 500ms -------------------------------
const { elapsedMs } = patients.createPatient(
    {
        firstName: 'Test',
        lastName: 'Camper',
        dateOfBirth: '2016-01-01',
        primaryDiagnosis: 'N/A',
        knownAllergies: '',
        medicalNotes: null,
        campSessionDate: '2026-07-01',
        createdBy: testUserId,
    },
    testUserId
);
console.log(`Transaction time: ${elapsedMs.toFixed(2)} ms`);
console.log(elapsedMs < 500 ? 'PASS: under 500ms budget' : 'FAIL: exceeded 500ms budget');

db.close();

// Windows can briefly hold a file lock right after close(), and WAL mode
// creates sidecar files (-wal, -shm) alongside the main .db file — clean
// up all three, tolerating the harmless case where one's already gone.
for (const suffix of ['', '-wal', '-shm']) {
    try {
        fs.unlinkSync(testDbPath + suffix);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn(`Could not remove ${testDbPath + suffix}:`, err.message);
        }
    }
}