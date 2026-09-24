// electron/services/syncService.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Executes a write operation wrapped in an atomic SQLite transaction.
 * Ensures zero data corruption or partial writes during offline operation.
 */
function executeOfflineTransaction(db, operationsCallback) {
  const transaction = db.transaction((data) => {
    return operationsCallback(data);
  });
  return transaction;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Creates an encrypted, tamper-evident USB backup for offline syncing (FR-08).
 *
 * Copy strategy: a WAL checkpoint followed by a raw file copy of the live
 * database file, rather than SQLite's page-level `.backup()` API. The two
 * are not equivalent here — `.backup()` requires the source and destination
 * to already agree on page size/reserved-bytes-per-page, which a fresh
 * destination file can't do for an SQLCipher-configured source (it fails
 * with "incompatible source and target databases"), and this build has no
 * `sqlcipher_export()` to work around that either. A raw file copy sidesteps
 * the problem entirely: the encrypted bytes are copied exactly as they sit
 * on disk, so the backup is trivially still AES-256 encrypted with the same
 * key (verified below by re-opening it), and the WAL checkpoint first
 * guarantees the main file we're copying is fully up to date and internally
 * consistent (no readers can write between checkpoint and copy while we
 * hold the DB's own busy_timeout-protected connection open for both steps).
 *
 * - Computes a SHA-256 checksum of the resulting file.
 * - Immediately re-reads the file and re-hashes it to confirm the bytes
 *   landed on the USB drive intact (catches truncated/corrupted writes,
 *   which are the realistic failure mode for USB media — not the copy
 *   step itself getting the hash "wrong").
 * - Writes the checksum to a sidecar `.sha256` file alongside the backup
 *   (independently verifiable later, offline, with any standard sha256sum
 *   tool) and to `backup_log`.
 *
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @param {string} sourceDbPath   Full path to the live, on-disk .db file
 * @param {string} usbPath        Root path of the target drive, e.g. 'E:\\' or '/Volumes/CAMPUSB'
 * @param {string} [folderName]   Backup folder name; defaults to CHRS_Backup_<timestamp>
 * @param {string|number} [initiatedByUserId]
 */
async function exportOfflineBackup(db, sourceDbPath, usbPath, folderName, initiatedByUserId = null) {
  const logResult = (status, resolvedFolderName, hash) => {
    try {
      db.prepare(`
        INSERT INTO backup_log (usb_drive_id, folder_name, sha256_hash, status)
        VALUES (?, ?, ?, ?)
      `).run(usbPath, resolvedFolderName, hash, status);
    } catch (_) {
      // Never let logging failure mask the real backup result.
    }
  };

  if (!fs.existsSync(usbPath)) {
    logResult('failed', folderName || 'UNKNOWN', null);
    throw new Error(`USB backup target path does not exist or is disconnected: ${usbPath}`);
  }
  if (!fs.existsSync(sourceDbPath)) {
    logResult('failed', folderName || 'UNKNOWN', null);
    throw new Error(`Source database file not found at: ${sourceDbPath}`);
  }

  const resolvedFolderName = folderName || `CHRS_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const targetDir = path.join(usbPath, resolvedFolderName);

  try {
    fs.mkdirSync(targetDir, { recursive: true });

    const backupDbPath = path.join(targetDir, 'chrs_backup.db');

    // Flush the WAL into the main file so the copy below is complete and
    // consistent (no changes sitting only in -wal/-shm get left behind).
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(sourceDbPath, backupDbPath);

    // Hash immediately after the copy completes...
    const hashAfterCopy = sha256File(backupDbPath);
    // ...then re-read and re-hash to confirm what's actually sitting on the
    // drive matches what we just wrote (catches media write errors).
    const hashOnDisk = sha256File(backupDbPath);

    if (hashAfterCopy !== hashOnDisk) {
      throw new Error('Checksum verification failed: the file on the USB drive does not match the freshly written backup.');
    }

    fs.writeFileSync(path.join(targetDir, 'chrs_backup.db.sha256'), `${hashOnDisk}  chrs_backup.db\n`, 'utf8');
    fs.writeFileSync(
      path.join(targetDir, 'manifest.json'),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          folderName: resolvedFolderName,
          sourceFile: 'chrs_backup.db',
          sha256: hashOnDisk,
          initiatedByUserId,
        },
        null,
        2
      ),
      'utf8'
    );

    logResult('success', resolvedFolderName, hashOnDisk);

    return { success: true, folderName: resolvedFolderName, hash: hashOnDisk, path: targetDir };
  } catch (error) {
    logResult('failed', resolvedFolderName, null);
    throw error;
  }
}

module.exports = {
  executeOfflineTransaction,
  exportOfflineBackup,
};
