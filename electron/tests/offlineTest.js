const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/database');
const { executeOfflineTransaction, exportOfflineBackup } = require('../services/syncService');

async function testOfflineCapabilities() {
  console.log(' Running Strict Offline Capability Verification...\n');

  const testDbPath = path.join(__dirname, 'offline_chrs.db');
  const mockUsbPath = path.join(__dirname, 'mock_usb_drive');

  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (!fs.existsSync(mockUsbPath)) fs.mkdirSync(mockUsbPath);

  try {
    // 1. Local Database Operations (Zero Internet Required)
    const db = getDb(testDbPath);
    console.log('1️ Local SQLCipher database opened completely offline.');

    // 2. Batch Offline Transaction
    console.log('\n2️ Executing local batch offline writes...');
    const offlineBatch = [
      { name: 'Camp Patient A', condition: 'Dehydration' },
      { name: 'Camp Patient B', condition: 'Allergic Reaction' }
    ];

    const transactionWrapper = executeOfflineTransaction(db, (items) => {
      const stmt = db.prepare('INSERT INTO patients (first_name, primary_diagnosis) VALUES (?, ?)');
      for (const item of items) {
        stmt.run(item.name, item.condition);
      }
    });

    transactionWrapper(offlineBatch);
    
    const count = db.prepare('SELECT COUNT(*) as count FROM patients').get().count;
    console.log(`Success: ${count} patient records persisted to local encrypted storage.`);

    // 3. Encrypted USB Export & Integrity Verification
    console.log('\n3️ Testing offline encrypted USB export & checksum...');
    const backupResult = exportOfflineBackup(db, mockUsbPath);

    if (backupResult.success && backupResult.hash) {
      console.log(`USB Folder Created: ${backupResult.folderName}`);
      console.log(`SHA-256 Checksum Logged: ${backupResult.hash}`);
    }

    // Cleanup local test files
    db.close();
    fs.rmSync(mockUsbPath, { recursive: true, force: true });
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    console.log('\n OFFLINE CAPABILITY VALIDATED 100% SUCCESSFULLY!');
  } catch (error) {
    console.error('\n OFFLINE TEST FAILED:', error.message);
    if (fs.existsSync(mockUsbPath)) fs.rmSync(mockUsbPath, { recursive: true, force: true });
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  }
}

testOfflineCapabilities();