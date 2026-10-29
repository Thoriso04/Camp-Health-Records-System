// Runs the REAL schema.sql + migrations 003-005 and the REAL service code on node:sqlite.
// (better-sqlite3 isn't installable offline here; this shim only adds .transaction().)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), path = require('path');
const root = '/home/claude/Camp-Health-Records-System/electron';
const raw = new DatabaseSync(':memory:');
raw.exec('PRAGMA foreign_keys = ON');
const db = {
  prepare: (sql) => { const s = raw.prepare(sql); s.source = sql; return s; },
  exec: (sql) => raw.exec(sql),
  transaction: (fn) => (...a) => { raw.exec('BEGIN'); try { const r = fn(...a); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
};
raw.exec(fs.readFileSync(`${root}/database/schema.sql`, 'utf8'));
for (const f of ['003_sheet_sync.sql','004_sync_log_source.sql','005_clinical_forms.sql'])
  raw.exec(fs.readFileSync(`${root}/database/migrations/${f}`, 'utf8'));

raw.exec(`INSERT INTO users (username,password_hash,role,full_name) VALUES
  ('doc','x','camp_physician','Dr Doc'),('nurse','x','camp_nurse','Nurse N'),('admin','x','camp_administrator','Admin A')`);
raw.exec(`INSERT INTO patients (first_name,last_name,date_of_birth,primary_diagnosis,camp_session_date,created_by)
  VALUES ('Thandi','Nkosi','2014-03-02','HIV','2026-12-01',1)`);

const svc = require(`${root}/services/clinicalFormsService.js`);
const { createAuditLogger } = require(`${root}/database/auditLog.js`);
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const throws = (n, f, re) => { try { f(); ok(n, false); } catch (e) { ok(`${n}  -> "${e.message.slice(0,70)}"`, re.test(e.message)); } };

// FR-03
let r = svc.saveMedicationCheckin(db, { patientId: '1', userId: 1, medicalPersonName: 'Dr Doc', medicalPersonSignature: 'data:x',
  currentMedications: ['TDF', ' ', 'DTG'], accessibility: { eyesight: 'ok' }, tbScreening: { coughOver2Weeks: false } });
ok('FR-03 saves', r.success && r.id === '1');
ok('FR-03 items inserted (blank skipped)', raw.prepare('SELECT count(*) c FROM medication_checkin_items').get().c === 2);
ok('FR-03 form_data stored', JSON.parse(raw.prepare('SELECT form_data f FROM medication_checkins').get().f).accessibility.eyesight === 'ok');
throws('FR-03 locked after save', () => raw.exec("UPDATE medication_checkins SET clinician_signoff='x'"), /immutable/);
r = svc.saveMedicationCheckin(db, { patientId: 'CAMPER-001', userId: 1, medicalPersonName: 'Dr Doc' });
ok('FR-03 accepts display id CAMPER-001', r.success);
throws('FR-03 empty patient id rejected', () => svc.saveMedicationCheckin(db, { patientId: '', userId: 1, medicalPersonName: 'x' }), /No patient selected/);
throws('FR-03 bad patient rejected', () => svc.saveMedicationCheckin(db, { patientId: '99', userId: 1, medicalPersonName: 'x' }), /could not be found/);
throws('FR-03 unsigned rejected', () => svc.saveMedicationCheckin(db, { patientId: '1', userId: 1, medicalPersonName: ' ' }), /sign off/);

// FR-04
r = svc.saveMedShackVisit(db, { patientId: '1', userId: 1, status: 'draft', clinicianName: 'Dr Doc', clinicianRole: 'camp_physician', reason: 'Headache' });
ok('FR-04 draft saves', r.success && r.status === 'draft');
const vid = r.id;
r = svc.saveMedShackVisit(db, { patientId: '1', userId: 1, visitId: vid, status: 'draft', clinicianName: 'Dr Doc', reason: 'Headache + fever' });
ok('FR-04 re-saving draft updates same row', r.id === vid && raw.prepare('SELECT count(*) c FROM medshack_visits').get().c === 1);
throws('FR-04 final needs disposition', () => svc.saveMedShackVisit(db, { patientId: '1', userId: 1, visitId: vid, status: 'final', clinicianName: 'Dr', reason: 'x' }), /Disposition/);
r = svc.saveMedShackVisit(db, { patientId: '1', userId: 1, visitId: vid, status: 'final', clinicianName: 'Dr Doc', reason: 'Headache', disposition: 'Returned to cabin' });
ok('FR-04 finalises', r.status === 'final');
throws('FR-04 final is locked (service)', () => svc.saveMedShackVisit(db, { patientId: '1', userId: 1, visitId: vid, status: 'draft', clinicianName: 'Dr' }), /finalised/);
throws('FR-04 final is locked (DB trigger)', () => raw.exec("UPDATE medshack_visits SET notes='tamper'"), /immutable/);

// FR-05
const inc = { classification: 'medication-error', dateTime: '2026-11-02T10:30', location: 'MedShack', patientsInvolved: ['thandi nkosi', 'Unknown Kid'],
  staffInvolved: ['Nurse N'], description: 'Wrong dose drawn up', correctiveActions: 'Dose corrected; parent informed', reportedByUserId: 2 };
r = svc.saveIncidentReport(db, inc);
ok('FR-05 nurse can file', r.success);
ok('FR-05 matched patient linked, unmatched kept as text',
  raw.prepare('SELECT count(*) c FROM near_miss_patients').get().c === 1 &&
  JSON.parse(raw.prepare('SELECT patients_involved p FROM near_miss_incidents').get().p).length === 2);
throws('FR-05 admin role refused', () => svc.saveIncidentReport(db, { ...inc, reportedByUserId: 3 }), /not permitted/);
throws('FR-05 blank corrective actions refused', () => svc.saveIncidentReport(db, { ...inc, correctiveActions: '  ' }), /Corrective actions/);
throws('FR-05 cannot be edited once filed', () => raw.exec("UPDATE near_miss_incidents SET description='x'"), /cannot be edited/);
throws('FR-05 cannot be deleted', () => raw.exec('DELETE FROM near_miss_incidents'), /cannot be deleted/);

// FR-06
r = svc.saveStaffCheckin(db, { recordedByUserId: 1, fullName: 'Sipho Dlamini', role: 'Cook', campSite: 'Kitchen', complaint: 'Burn on hand',
  vitals: { temperature: '36.8' }, disposition: 'Treated, returned to duty' });
ok('FR-06 saves', r.success);
const row = raw.prepare('SELECT * FROM staff_checkins').get();
ok('FR-06 12-month retention set', new Date(row.retain_until) > new Date(Date.now() + 360 * 864e5));
ok('FR-06 no patient link column', !('patient_id' in row));
throws('FR-06 missing site refused', () => svc.saveStaffCheckin(db, { recordedByUserId: 1, fullName: 'A', complaint: 'x', disposition: 'y' }), /Camp site/);
throws('FR-06 unknown user refused', () => svc.saveStaffCheckin(db, { recordedByUserId: 999, fullName: 'A', campSite: 'B', complaint: 'x', disposition: 'y' }), /No active database user/);

// ---------------- viewing ----------------
const rec = require(`${root}/services/clinicalRecordsService.js`);
const auditBefore = raw.prepare('SELECT count(*) c FROM audit_log').get().c;
let l = rec.listPatientRecords(db, { patientId: 'CAMPER-001', userId: 1 });
ok('list: patient history has check-ins and visits', l.medicationCheckins.length === 2 && l.visits.length === 1 && l.visits[0].status === 'final');
ok('list: newest first', l.medicationCheckins[0].id >= l.medicationCheckins[1].id);
ok('list: does not write audit rows', raw.prepare('SELECT count(*) c FROM audit_log').get().c === auditBefore);
ok('list: admin may view camper history', rec.listPatientRecords(db, { patientId: '1', userId: 3 }).success);
let g = rec.getRecord(db, { kind: 'medication', id: 1, userId: 1 });
ok('view medication: sections + signature', g.record.sections.length === 6 && g.record.signature === null && g.record.sections[0].rows[0].value === 'ok');
ok('view medication: meds listed', /1\. TDF/.test(g.record.sections[3].rows[3].value));
g = rec.getRecord(db, { kind: 'visit', id: vid, userId: 2 });
ok('view visit: final has no draft payload', g.record.status === 'Finalised' && g.record.draft === null);
const d2 = svc.saveMedShackVisit(db, { patientId: '1', userId: 1, status: 'draft', clinicianName: 'Dr', reason: 'Cough' });
g = rec.getRecord(db, { kind: 'visit', id: d2.id, userId: 1 });
ok('view visit: draft returns resume payload', g.record.draft && g.record.draft.visitId === d2.id && g.record.draft.reason === 'Cough');
g = rec.getRecord(db, { kind: 'incident', id: 1, userId: 2 });
ok('view incident: patient link shown', /linked to profile/.test(g.record.sections[0].rows[3].value) && /Unknown Kid/.test(g.record.sections[0].rows[3].value));
throws('incident hidden from administrator', () => rec.getRecord(db, { kind: 'incident', id: 1, userId: 3 }), /not permitted/);
throws('incident list hidden from administrator', () => rec.listReports(db, { kind: 'incident', userId: 3 }), /not permitted/);
throws('staff list hidden from administrator', () => rec.listReports(db, { kind: 'staff', userId: 3 }), /not permitted/);
ok('incident list', rec.listReports(db, { kind: 'incident', userId: 1 }).reports[0].incidentTypeLabel === 'Medication error');
ok('staff list', rec.listReports(db, { kind: 'staff', userId: 2 }).reports[0].fullName === 'Sipho Dlamini');
g = rec.getRecord(db, { kind: 'staff', id: 1, userId: 1 });
ok('view staff', g.record.subtitle === 'Sipho Dlamini' && /Kept until/.test(g.record.status));
throws('missing record', () => rec.getRecord(db, { kind: 'visit', id: 999, userId: 1 }), /could not be found/);
throws('unknown kind', () => rec.getRecord(db, { kind: 'nope', id: 1, userId: 1 }), /Unknown record type/);
const reads = raw.prepare("SELECT count(*) c FROM audit_log WHERE action_type='READ'").get().c;
ok('each opened record wrote a READ audit row (5 opens)', reads === 5);
const failedOpen = raw.prepare('SELECT count(*) c FROM audit_log').get().c;
try { rec.getRecord(db, { kind: 'visit', id: 999, userId: 1 }); } catch {}
ok('failed open writes no audit row', raw.prepare('SELECT count(*) c FROM audit_log').get().c === failedOpen);

// Audit chain
const a = raw.prepare("SELECT target_table, action_type FROM audit_log WHERE action_type != 'READ' ORDER BY id").all().map(x => x.target_table + ':' + x.action_type);
console.log('audit rows:', a.join(', '));
ok('Audit rows written with records', a.length === 8);
const chain = createAuditLogger(db).verifyChain();
ok('Audit hash chain still verifies', chain.valid === true || chain.ok === true || chain.isValid === true);
ok('Failed saves left no partial rows', raw.prepare('SELECT count(*) c FROM medication_checkins').get().c === 2 && raw.prepare('SELECT count(*) c FROM near_miss_incidents').get().c === 1);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
