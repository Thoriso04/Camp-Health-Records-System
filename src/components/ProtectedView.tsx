import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Permission, Role } from '../types/auth';
import { hasPermission } from '../utils/rbac';

interface ProtectedViewProps {
  requiredPermission?: Permission;
  requiredRole?: Role;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const ProtectedView: React.FC<ProtectedViewProps> = ({
  requiredPermission,
  requiredRole,
  fallback = null,
  children
}) => {
  const { user } = useAuth();

  if (!user) return <>{fallback}</>;

  if (requiredRole && user.role !== requiredRole && user.role !== 'Admin') {
    return <>{fallback}</>;
  }

  if (requiredPermission && !hasPermission(user.role as Role, requiredPermission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
