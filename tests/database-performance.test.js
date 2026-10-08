const Database = require('better-sqlite3-multiple-ciphers');

describe('Database Performance Benchmark', () => {
  let db;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        dob TEXT,
        medical_history TEXT
      )
    `);

    const insert = db.prepare('INSERT INTO patients (name, dob, medical_history) VALUES (?, ?, ?)');
    const seedTransaction = db.transaction((patients) => {
      for (const patient of patients) {
        insert.run(patient.name, patient.dob, patient.medical_history);
      }
    });

    const mockPatients = Array.from({ length: 100 }, (_, index) => ({
      name: `Patient ${index + 1}`,
      dob: '1990-01-01',
      medical_history: 'No known allergies',
    }));

    seedTransaction(mockPatients);
  });

  afterAll(() => {
    db.close();
  });

  it('should fetch 100 patient profiles in under 2000ms', () => {
    const startTime = performance.now();

    const patients = db.prepare('SELECT * FROM patients LIMIT 100').all();

    const duration = performance.now() - startTime;

    expect(patients).toHaveLength(100);
    expect(duration).toBeLessThan(2000);
    console.log(`Query execution time for 100 patients: ${duration.toFixed(2)}ms`);
  });
});