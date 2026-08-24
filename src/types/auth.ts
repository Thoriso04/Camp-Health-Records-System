export type Role = 'Admin' | 'Physician' | 'Nurse' | 'Counselor';

export type Permission =
  | 'VIEW_CLINICAL_RECORDS'
  | 'EDIT_CLINICAL_RECORDS'
  | 'MANAGE_USERS'
  | 'IMPORT_CSV'
  | 'VIEW_AUDIT_LOGS'
  | 'FILE_INCIDENT_REPORT'
  | 'MANAGE_BACKUP';

export interface UserSession {
  userId: string;
  username: string;
  role: Role;
}
