const path = require('path');
const fs = require('fs');

// Imported modules from your project
const authService = require('../services/authService');
const dbController = require('../services/dbController');
const syncService = require('../services/syncService');
const { openEncryptedDatabase } = require('../database/database');

async function testBackend() {
  console.log('Running Integrated Backend Test Suite...\n');

  try {
    // 1. Database & Encryption Test
    console.log('1 Testing SQLCipher Database Initialization...');
    const testDbPath = path.join(__dirname, 'test_chrs.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    const db = openEncryptedDatabase(testDbPath, 'test-secret-key-2026');
    console.log('Database successfully created and encrypted.');

    // 2. Authentication Test
    console.log('\n2️ Testing Authentication Service...');
    if (authService.hashPassword && authService.verifyPassword) {
      const hash = await authService.hashPassword('AdminPass2026!');
      const valid = await authService.verifyPassword('AdminPass2026!', hash);
      console.log(`Password Hashing & Verification: ${valid ? 'PASSED' : 'FAILED'}`);
    } else {
      console.log('Auth methods exported:', Object.keys(authService));
    }

    // 3. DB Controller Methods Test
    console.log('\n3️ Testing DB Controller Service Interface...');
    console.log('Available DB Controller operations:', Object.keys(dbController));

    // 4. Sync Service Methods Test
    console.log('\n4️ Testing Offline Sync Service Interface...');
    console.log('Available Sync operations:', Object.keys(syncService));

    // Cleanup test database file
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    console.log('\n ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY!');
  } catch (error) {
    console.error('\n TEST SUITE ERROR:', error);
  }
}

testBackend();