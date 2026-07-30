/**
 * Aico auth helpers for org / platform RBAC and phone-verify policy.
 */

import { OrganizationModel } from '@/database/models/organization';
import { getServerDB } from '@/database/server';

export type OrgRole = 'owner' | 'admin' | 'member';

/**
 * Resolve the caller's role inside an organization.
 */
export async function getCurrentOrgRole(userId: string, orgId: string): Promise<OrgRole | null> {
  const db = await getServerDB();
  const model = new OrganizationModel(db);
  return model.getMemberRole(userId, orgId);
}

/**
 * Whether the user is a platform (super) admin — independent of org roles.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const db = await getServerDB();
  const model = new OrganizationModel(db);
  return model.isPlatformAdmin(userId);
}

export interface RequiresPhoneVerificationInput {
  /**
   * Optional active org. When omitted / null, the user is treated as an
   * independent buyer (must verify phone to claim trial / spend).
   */
  orgId?: string | null;
  phoneNumberVerified: boolean;
  userId: string;
}

/**
 * Phone verify policy for **trial / spend activation** (not login):
 * - Already verified → skip
 * - Org `member` (invited, non-buyer) → skip
 * - Org `owner` / `admin` → require before spending / trial
 * - No org / unknown role (independent buyer) → require before trial
 *
 * Login and signup must NOT call this as a hard gate.
 */
export async function requiresPhoneVerification(
  input: RequiresPhoneVerificationInput,
): Promise<boolean> {
  if (input.phoneNumberVerified) return false;

  if (input.orgId) {
    const role = await getCurrentOrgRole(input.userId, input.orgId);
    if (role === 'member') return false;
    if (role === 'owner' || role === 'admin') return true;
  }

  // Independent buyer, or unknown role
  return true;
}
