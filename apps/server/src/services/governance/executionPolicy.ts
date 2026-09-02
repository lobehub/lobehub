import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { getPolicyForUser } from './executionPolicyRepository';
import { isGovernanceEnabled } from './policyGate';
import type { ResolvedExecutionPolicy } from './types';

const log = debug('lobe-server:governance:execution-policy');

/**
 * Resolve the execution policy the CLI/desktop should enforce for one user,
 * or `null` when there is none — no row, the row is disabled, or the
 * governance feature flag is off. `null` means "unrestricted": the caller
 * falls back to its existing behavior, never to "deny everything".
 *
 * Same fail-open posture as `checkCommand`: a lookup failure (DB down,
 * malformed row) must not be able to lock a user out of their own machine, so
 * it resolves to `null` rather than throwing or denying.
 */
export const getUserExecutionPolicy = async (
  userId: string,
  db: LobeChatDatabase,
): Promise<ResolvedExecutionPolicy | null> => {
  if (!isGovernanceEnabled()) return null;

  try {
    const row = await getPolicyForUser(db, userId);
    if (!row || !row.enabled) return null;

    return {
      allowedNetworkDomains: row.allowedNetworkDomains ?? undefined,
      allowNetwork: row.allowNetwork,
      commandMode: row.commandMode,
      deniedReadRoots: row.deniedReadRoots ?? undefined,
      deniedWriteRoots: row.deniedWriteRoots ?? undefined,
      enabled: row.enabled,
      envAllowlist: row.envAllowlist ?? undefined,
      readableRoots: row.readableRoots ?? undefined,
      writableRoots: row.writableRoots,
    };
  } catch (error) {
    console.error('[governance] getUserExecutionPolicy failed, failing open (null): %O', error);
    log('getUserExecutionPolicy failed for user %s: %O', userId, error);
    return null;
  }
};
