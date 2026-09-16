import {
  deriveSandboxWorkspaceKey,
  type SandboxWorkspaceClaim,
  type SandboxWorkspaceScope,
} from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { resolveSandboxWorkspaceQuotaBytes } from '@/business/server/sandboxWorkspace';
import { UserModel } from '@/database/models/user';

const log = debug('lobe-server:sandbox:entitlement');

export interface SandboxWorkspaceClaimInput extends SandboxWorkspaceScope {
  /**
   * Whether this run is an Agent Share visitor's. Required rather than optional:
   * such a run executes under the CREATOR's identity, so every input this
   * function reads — the lab flag, the plan, the key — describes the creator,
   * not the person at the keyboard. Issuing a claim would hand a visitor the
   * creator's working directory, with everything their other conversations left
   * in it, to read and overwrite. Making the caller state it means a new call
   * site cannot inherit the dangerous answer by saying nothing.
   */
  isShareVisitorRun: boolean;
  serverDB: LobeChatDatabase;
}

/**
 * Resolve the persistent-workspace entitlement for a principal into the claim
 * that gets signed onto the trusted-client token.
 *
 * Three things must all hold, and the order is deliberate — cheapest and most
 * selective first:
 *
 * 1. The run is the principal's own (not a share visitor's).
 * 2. Their identity yields a safe directory name.
 * 3. They opted into the `enablePersistentSandbox` lab experiment, and their
 *    plan entitles them to storage.
 *
 * Returns `null` for "no persistent workspace", which is the shape the
 * execution plane reads as free tier. Without a claim its routing sends the run
 * to the ephemeral sandbox no matter what mode the request asks for, so this is
 * the single gate for the whole feature: nothing a client sends can open it.
 *
 * Never throws: a preference or subscription lookup that fails must not take
 * the sandbox down with it. The run degrades to an ephemeral sandbox, which is
 * what every session does today.
 */
export const resolveSandboxWorkspaceClaim = async ({
  isShareVisitorRun,
  serverDB,
  userId,
  workspaceId,
}: SandboxWorkspaceClaimInput): Promise<SandboxWorkspaceClaim | null> => {
  if (isShareVisitorRun) return null;

  const key = deriveSandboxWorkspaceKey({ userId, workspaceId });
  if (!key) return null;

  try {
    // Opt-in is per USER even for an organization run, like every other lab
    // experiment. The consequence is worth knowing: in a workspace where only
    // some members have switched it on, the shared directory is there for their
    // runs and absent for everyone else's.
    const preference = await new UserModel(serverDB, userId).getUserPreference();
    if (preference?.lab?.enablePersistentSandbox !== true) return null;

    const quotaBytes = await resolveSandboxWorkspaceQuotaBytes({ userId, workspaceId });
    if (typeof quotaBytes !== 'number' || !Number.isSafeInteger(quotaBytes) || quotaBytes <= 0) {
      return null;
    }

    return { key, quotaBytes };
  } catch (error) {
    log('Failed to resolve the sandbox workspace entitlement for %s: %O', key, error);
    return null;
  }
};
