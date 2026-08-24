import { Permission, Role } from '../types/auth';

/**
 * MANAGE_BACKUP added for FR-08 (USB Backup), granted to Physician only.
 * Per the tech spec's Assumptions/Dependencies section: "The Camp
 * Physician's Windows laptop meets the minimum hardware specification"
 * and "Camp Physician acts as system administrator" — Physician is the
 * one who owns the laptop backups run from, not Admin (Camp
 * Administrator, who per the FSD has no clinical or system-admin
 * rights at all — just CSV import and read-only profile access).
 */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Admin: ['VIEW_CLINICAL_RECORDS', 'MANAGE_USERS', 'IMPORT_CSV'],
  Physician: ['VIEW_CLINICAL_RECORDS', 'EDIT_CLINICAL_RECORDS', 'IMPORT_CSV', 'VIEW_AUDIT_LOGS', 'FILE_INCIDENT_REPORT', 'MANAGE_BACKUP'],
  Nurse: ['VIEW_CLINICAL_RECORDS', 'EDIT_CLINICAL_RECORDS', 'FILE_INCIDENT_REPORT'],
  Counselor: ['VIEW_CLINICAL_RECORDS']
};

export const hasPermission = (userRole: Role | undefined, permission: Permission): boolean => {
  if (!userRole) return false;
  const allowedPermissions = ROLE_PERMISSIONS[userRole] || [];
  return allowedPermissions.includes(permission);
};