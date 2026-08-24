import type { Role } from '../types/auth';

/**
 * RoleBadge
 *
 * NOTE: types/auth.ts defines roles as Admin | Physician | Nurse |
 * Counselor, which does NOT match the FSD (Section 3: Camp Physician,
 * Camp Nursing Staff, Paramedic, Camp Administrator) — "Counselor" isn't
 * a spec'd role at all, and two spec roles are missing entirely. Mapped
 * against the CODE's role model here since that's what compiles; flag
 * this mismatch to the team so the type definitions get reconciled
 * with the spec.
 */
const ROLE_STYLES: Record<Role, string> = {
  Admin: 'bg-clinical-50 text-clinical-700',
  Physician: 'bg-clinical-50 text-clinical-700',
  Nurse: 'bg-confirm-50 text-confirm-600',
  Counselor: 'bg-amber-50 text-amber-600',
};

interface RoleBadgeProps {
  role?: Role;
}

export default function RoleBadge({ role }: RoleBadgeProps) {
  if (!role) return null;
  const styles = ROLE_STYLES[role] ?? 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${styles}`}>
      {role}
    </span>
  );
}