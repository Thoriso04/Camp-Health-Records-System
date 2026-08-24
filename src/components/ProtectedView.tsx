import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Permission, Role } from '../types/auth';
import { hasPermission } from '../utils/rbac';

interface ProtectedViewProps {
  requiredPermission?: Permission;
  requiredRole?: Role | Role[];
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

  // Convert requiredRole into an array for uniform checking
  if (requiredRole) {
    const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    
    // Always allow Admin, plus any explicitly allowed roles
    const isRoleAllowed = user.role === 'Admin' || allowedRoles.includes(user.role as Role);
    
    if (!isRoleAllowed) {
      return <>{fallback}</>;
    }
  }

  if (requiredPermission && !hasPermission(user.role as Role, requiredPermission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};