// electron/database/database.js
//
// CHRS encrypted database connection.
// Uses better-sqlite3-multiple-ciphers, a drop-in-compatible fork of
// better-sqlite3 that links against SQLite3 Multiple Ciphers (an
// SQLCipher-compatible extension), so the existing better-sqlite3
// API/ORM code (per the Technical Spec) works unchanged while the
// file on disk is AES-256 encrypted.
//
// This module must only ever be required from the Electron MAIN process.
// The renderer talks to it exclusively via IPC (see preload.js) — never
// give the renderer direct `require` access to this file or to `fs`.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3-multiple-ciphers');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// kdf_algorithm / hmac_algorithm use integer codes in this driver's
// PRAGMA dialect (not the string names SQLCipher itself accepts).
const HASH_ALGORITHM = {
    SHA1: 0,
    SHA256: 1,
    SHA512: 2,
};

/**
 * Opens (creating if necessary) the encrypted CHRS database.
 *
 * @param {string} dbFilePath  Full path to the .db file,
 *                              e.g. path.join(app.getPath('appData'), 'CHRS', 'chrs.db')
 * @param {string} encryptionKey  The raw passphrase/key. In production this
 *                              is retrieved from Windows DPAPI via
 *                              electron's safeStorage — never hard-code it
 *                              and never log it.
 * @returns {import('better-sqlite3-multiple-ciphers').Database}
 */
function openEncryptedDatabase(dbFilePath, encryptionKey) {
    if (!encryptionKey) {
        throw new Error('openEncryptedDatabase: encryptionKey is required');
    }

    fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

    const db = new Database(dbFilePath);

    // --- SQLCipher-compatible configuration ---------------------------
    // Order matters: 1) select cipher scheme, 2) set its parameters,
    // 3) apply the key. This must all happen before any other statement
    // touches the database.
    db.pragma(`cipher = 'sqlcipher'`);
    db.pragma('legacy = 0');                                    // current (non-legacy) defaults
    db.pragma('kdf_iter = 256000');                           // PBKDF2 iteration count (OWASP-aligned minimum)
    db.pragma(`kdf_algorithm = ${HASH_ALGORITHM.SHA512}`);    // PBKDF2-HMAC-SHA512
    db.pragma(`hmac_algorithm = ${HASH_ALGORITHM.SHA512}`);   // per-page HMAC using SHA512

    // The key PRAGMA must be quoted; this both sets the key and, on an
    // existing file, attempts to decrypt it. A wrong key does not throw
    // immediately — it throws on the first real read, which is why we
    // immediately run a verification query below.
    db.pragma(`key = '${encryptionKey.replace(/'/g, "''")}'`);

    // Verify the key is correct / the file is a valid encrypted database.
    // This will throw if the key is wrong or the file isn't a valid DB.
    db.prepare('SELECT count(*) FROM sqlite_master').get();

    // --- Standard SQLite reliability/performance settings -------------
    db.pragma('journal_mode = WAL');       // crash-safe writes, better concurrency
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL');       // durability over raw speed — this is medical data
    db.pragma('busy_timeout = 5000');

    applySchema(db);

    return db;
}

/**
 * Safely applies the initial schema only if the database is uninitialized.
 *
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 */
function applySchema(db) {
    // Check if the database has already been initialized by checking schema_version
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();

    if (!tableExists) {
        console.log('[Backend DB] New database detected. Applying schema...');
        const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
        const applySchemaTxn = db.transaction(() => {
            db.exec(schemaSql);
        });
        applySchemaTxn();
        console.log('[Backend DB] Schema successfully applied.');
    } else {
        console.log('[Backend DB] Existing database detected. Skipping schema initialization.');
    }
}

/**
 * Rewraps the database with a new key. Use for periodic key rotation.
 * Requires the CURRENT key to already be applied to `db` via `key = ...`.
 */
function rekeyDatabase(db, newKey) {
    db.pragma(`rekey = '${newKey.replace(/'/g, "''")}'`);
}

module.exports = {
    openEncryptedDatabase,
    rekeyDatabase,
};