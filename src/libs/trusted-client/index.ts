import type { SandboxWorkspaceClaim } from '@lobechat/builtin-tool-cloud-sandbox';
import {
  buildTrustedClientPayload,
  createTrustedClientToken,
  type TrustedClientPayload,
} from '@lobehub/market-sdk';

import { appEnv } from '@/envs/app';

export interface TrustedClientUserInfo {
  email?: string;
  name?: string;
  /**
   * Persistent-sandbox entitlement for this principal, resolved by
   * `resolveSandboxWorkspaceClaim`. Absent — the shape every caller that does
   * not create sandboxes leaves it in — means the sandbox stays ephemeral.
   *
   * It rides the token rather than the request body on purpose: it is the one
   * thing the execution plane must not let a caller choose for itself.
   */
  sandboxWorkspace?: SandboxWorkspaceClaim | null;
  userId: string;
  /**
   * Cloud workspace id the request acts on behalf of. When set, Market treats
   * the caller as the workspace's mirrored organization (resolved via the
   * `workspace:<workspaceId>` clerkId convention), mirroring how `userId`
   * identifies the personal account. Omit for personal requests.
   */
  workspaceId?: string;
}

export { getSessionUser } from './getSessionUser';

/**
 * Synthetic user ids used by local agent-evals / smoke scripts (e.g. `eval_*`,
 * `qstash_smoke_*`). These are never real platform accounts — no real userId
 * carries these prefixes — so Market rejects any trusted-client token built
 * from them with `invalid_trust_token / Invalid userId format`. We skip token
 * generation for them to avoid the doomed round-trip and the noisy prep drag it
 * causes during evals.
 */
const SYNTHETIC_USER_ID_PATTERN = /^(?:eval|qstash_smoke)_/;

export const isSyntheticTrustedClientUserId = (userId: string): boolean =>
  SYNTHETIC_USER_ID_PATTERN.test(userId);

/**
 * Check if trusted client authentication is enabled
 */
export const isTrustedClientEnabled = (): boolean => {
  return !!(appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID);
};

/**
 * Generate trusted client token for a specific user
 * This token includes encrypted user info and is used for Market API authentication
 *
 * @param userInfo - User information (userId, email, name)
 * @returns Encrypted token string or undefined if not configured
 */
export const generateTrustedClientToken = (userInfo: TrustedClientUserInfo): string | undefined => {
  const { MARKET_TRUSTED_CLIENT_SECRET, MARKET_TRUSTED_CLIENT_ID } = appEnv;

  if (!MARKET_TRUSTED_CLIENT_SECRET || !MARKET_TRUSTED_CLIENT_ID) {
    return undefined;
  }

  // Synthetic eval/smoke userIds can never be valid Market accounts; skip
  // signing a token Market is guaranteed to reject.
  if (isSyntheticTrustedClientUserId(userInfo.userId)) {
    return undefined;
  }

  try {
    const payload = buildTrustedClientPayload({
      clientId: MARKET_TRUSTED_CLIENT_ID,
      // TODO: remove '' when sdk update
      email: userInfo.email || '',
      name: userInfo.name,
      userId: userInfo.userId,
      workspaceId: userInfo.workspaceId,
    });

    // Attached after the builder rather than through it: the published SDK's
    // `buildTrustedClientPayload` still has a fixed parameter list that predates
    // this claim, while Market's verifier already reads it off the decrypted
    // payload. `createTrustedClientToken` signs whatever object it is handed, so
    // the field is covered by the signature exactly like the built-in ones.
    // Omitted when there is no entitlement, which is the free-tier shape and
    // leaves today's tokens unchanged.
    // TODO: pass through buildTrustedClientPayload once the SDK carries it.
    const signedPayload: TrustedClientPayload = userInfo.sandboxWorkspace
      ? ({ ...payload, sandboxWorkspace: userInfo.sandboxWorkspace } as TrustedClientPayload)
      : payload;

    return createTrustedClientToken(signedPayload, MARKET_TRUSTED_CLIENT_SECRET);
  } catch (error) {
    console.error('Failed to generate trusted client token:', error);
    return undefined;
  }
};

/**
 * Get trusted client token for the current session user
 * This is a convenience function that combines getSessionUser and generateTrustedClientToken
 *
 * @returns Encrypted token string or undefined if not configured or user not authenticated
 */
export const getTrustedClientTokenForSession = async (): Promise<string | undefined> => {
  const { getSessionUser } = await import('./getSessionUser');
  const userInfo = await getSessionUser();

  if (!userInfo) {
    return undefined;
  }

  return generateTrustedClientToken(userInfo);
};
