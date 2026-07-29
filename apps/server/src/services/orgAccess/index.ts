export type OrgRole = 'owner' | 'manager' | 'member';

/**
 * Resolve the caller's role within an organization.
 *
 * Stub until org membership tables land — always returns `null` so callers can
 * wire permission gates now and swap in the real lookup later.
 */
export const getCurrentOrgRole = async (_userId: string, _orgId: string): Promise<OrgRole | null> =>
  null;

/**
 * Whether the user is a platform-level administrator.
 *
 * Stub until the platform-admin table lands — always returns `false`.
 */
export const isPlatformAdmin = async (_userId: string): Promise<boolean> => false;
