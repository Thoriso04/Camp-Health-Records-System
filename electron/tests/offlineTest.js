const path = require('path');
const fs = require('fs');
const { openEncryptedDatabase } = require('../database/database');
const { executeOfflineTransaction, exportOfflineBackup } = require('../services/syncService');
const { createAuditLogger } = require('../database/auditLog');

async function testOfflineCapabilities() {
  console.log(' Running Strict Offline Capability Verification...\n');

  const testDbPath = path.join(__dirname, 'offline_chrs.db');
  const mockUsbPath = path.join(__dirname, 'mock_usb_drive');

  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (!fs.existsSync(mockUsbPath)) fs.mkdirSync(mockUsbPath);

  try {
    // 1. Local Database Operations (Zero Internet Required)
    const db = openEncryptedDatabase(testDbPath, 'test-secret-key-2026');
    console.log('1️ Local SQLCipher database opened completely offline.');

    // A created_by user must exist first — patients.created_by is a FK and
    // foreign_keys is ON.
    db.prepare(`
      INSERT INTO users (username, password_hash, role, full_name)
      VALUES ('offlinetest', 'not-a-real-hash', 'camp_physician', 'Offline Test User')
    `).run();
    const testUserId = db.prepare(`SELECT id FROM users WHERE username = 'offlinetest'`).get().id;

    // 2. Batch Offline Transaction (audit-logged, per FR-09 — every patient
    // data modification, including bulk/offline ones, gets a CREATE row)
    console.log('\n2️ Executing local batch offline writes...');
    const auditLog = createAuditLogger(db);
    const offlineBatch = [
      { first_name: 'Camp Patient A', last_name: 'Doe', date_of_birth: '2014-03-10', primary_diagnosis: 'Dehydration', camp_session_date: '2026-07-01' },
      { first_name: 'Camp Patient B', last_name: 'Roe', date_of_birth: '2013-11-22', primary_diagnosis: 'Allergic Reaction', camp_session_date: '2026-07-01' },
    ];

    const transactionWrapper = executeOfflineTransaction(db, (items) => {
      const stmt = db.prepare(`
        INSERT INTO patients (first_name, last_name, date_of_birth, primary_diagnosis, camp_session_date, created_by)
        VALUES (@first_name, @last_name, @date_of_birth, @primary_diagnosis, @camp_session_date, @created_by)
      `);
      for (const item of items) {
        const info = stmt.run({ ...item, created_by: testUserId });
        auditLog.logEvent({
          userId: testUserId,
          actionType: 'CREATE',
          targetTable: 'patients',
          targetId: info.lastInsertRowid,
          afterImage: { ...item, id: info.lastInsertRowid },
        });
      }
    });

    transactionWrapper(offlineBatch);

    const count = db.prepare('SELECT COUNT(*) as count FROM patients').get().count;
    console.log(`Success: ${count} patient records persisted to local encrypted storage.`);

    const chainCheck = auditLog.verifyChain();
    console.log(
      chainCheck.valid
        ? `Audit trail intact: ${chainCheck.checkedRows} tamper-evident entries verified.`
        : `AUDIT CHAIN BROKEN at row ${chainCheck.brokenAtId}: ${chainCheck.reason}`
    );
    if (!chainCheck.valid) throw new Error('Audit chain verification failed.');

    // 3. Encrypted USB Export & Integrity Verification
    console.log('\n3️ Testing offline encrypted USB export & checksum...');
    const backupResult = await exportOfflineBackup(db, testDbPath, mockUsbPath);

    if (backupResult.success && backupResult.hash) {
      console.log(`USB Folder Created: ${backupResult.folderName}`);
      console.log(`SHA-256 Checksum Logged: ${backupResult.hash}`);

      const sidecarPath = path.join(backupResult.path, 'chrs_backup.db.sha256');
      const sidecarExists = fs.existsSync(sidecarPath);
      console.log(`Checksum sidecar file present: ${sidecarExists ? 'YES' : 'NO'}`);
      if (!sidecarExists) throw new Error('Expected .sha256 sidecar file was not written.');
    } else {
      throw new Error('Backup did not report success/hash.');
    }

    // Cleanup local test files
    db.close();
    fs.rmSync(mockUsbPath, { recursive: true, force: true });
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

    console.log('\n OFFLINE CAPABILITY VALIDATED 100% SUCCESSFULLY!');
  } catch (error) {
    console.error('\n OFFLINE TEST FAILED:', error.message);
    if (fs.existsSync(mockUsbPath)) fs.rmSync(mockUsbPath, { recursive: true, force: true });
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    process.exitCode = 1;
  }
}

testOfflineCapabilities();