import { forbidden } from '../shared/errors';
export const BUSINESS_PERMISSIONS = [
  'campaigns:read',
  'campaigns:manage',
  'contacts:manage',
] as const;
export type BusinessPermission = (typeof BUSINESS_PERMISSIONS)[number];
const ROLE_PERMISSIONS: Record<string, readonly BusinessPermission[]> = {
  owner: BUSINESS_PERMISSIONS,
  member: ['campaigns:read'],
};
export function assertBusinessPermission(role: string, permission: BusinessPermission) {
  if (!ROLE_PERMISSIONS[role]?.includes(permission))
    throw forbidden('Insufficient business permission');
}
