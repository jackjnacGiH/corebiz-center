/**
 * Admin RBAC Phase 1 — preset-role helpers.
 *
 * Roles (back-office): owner > admin > staff. The real enforcement lives in the
 * DB (RLS / is_staff) and the `admin-users` edge function; these helpers drive
 * UI gating (which menus/buttons to show).
 */
import type { AppRole } from './supabase';

/** Roles an owner/admin may assign in Phase 1 (the 3 with full data access). */
export const ASSIGNABLE_ROLES: AppRole[] = ['owner', 'admin', 'staff'];

export const ROLE_LABEL_TH: Record<string, string> = {
  owner: 'เจ้าของ (Owner)',
  admin: 'ผู้ดูแล (Admin)',
  staff: 'พนักงาน (Staff)',
  agent: 'เซลล์ (Agent)',
  customer: 'ลูกค้า',
};

export const ROLE_LABEL_EN: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  staff: 'Staff',
  agent: 'Agent',
  customer: 'Customer',
};

export function roleLabel(role: string | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (!role) return '-';
  return (lang === 'en' ? ROLE_LABEL_EN : ROLE_LABEL_TH)[role] ?? role;
}

export const isOwner = (role?: AppRole | null) => role === 'owner';
export const isAdminOrOwner = (role?: AppRole | null) => role === 'owner' || role === 'admin';

/** Who can open the User Management page. */
export const canManageUsers = isAdminOrOwner;
/** Who can open System Settings. */
export const canSeeSettings = isAdminOrOwner;
