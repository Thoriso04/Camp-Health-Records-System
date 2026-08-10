import { Permission, Role } from '../types/auth';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Admin: ['VIEW_CLINICAL_RECORDS', 'EDIT_CLINICAL_RECORDS', 'MANAGE_USERS', 'IMPORT_CSV', 'VIEW_AUDIT_LOGS'],
  Physician: ['VIEW_CLINICAL_RECORDS', 'EDIT_CLINICAL_RECORDS', 'IMPORT_CSV'],
  Nurse: ['VIEW_CLINICAL_RECORDS', 'EDIT_CLINICAL_RECORDS'],
  Counselor: ['VIEW_CLINICAL_RECORDS']
};

export const hasPermission = (userRole: Role | undefined, permission: Permission): boolean => {
  if (!userRole) return false;
  const allowedPermissions = ROLE_PERMISSIONS[userRole] || [];
  return allowedPermissions.includes(permission);
};
