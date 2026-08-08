/**
 * Aico org / platform role helpers.
 *
 * Re-exports the real implementations from `auth/orgRole` so callers never
 * accidentally wire the historical stub that always returned null/false
 * (TENANT-005).
 */
export {
  getCurrentOrgRole,
  isPlatformAdmin,
  type OrgRole,
  requiresPhoneVerification,
  type RequiresPhoneVerificationInput,
} from '@/server/services/auth/orgRole';
