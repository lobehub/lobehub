import {
  deriveSandboxStorageKey,
  type SandboxStorageClaim,
  type SandboxStorageScope,
} from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';

import { resolveSandboxStorageEntitlement } from '@/business/server/sandboxStorage';

import { createFailureCooldown, warnSandboxDegraded } from './failureCooldown';

const log = debug('lobe-server:sandbox:entitlement');

const lookupFailures = createFailureCooldown();

/**
 * Why a principal has no claim. The first three are lasting answers, "this run
 * never gets a drive"; the last two are "cannot tell right now", the only ones
 * that say anything is wrong.
 */
export type SandboxStorageClaimDenial =
  'lookupBackoff' | 'lookupFailed' | 'noStorageKey' | 'notEntitled' | 'shareVisitor';

export interface SandboxStorageClaimResult {
  claim: SandboxStorageClaim | null;
  denial?: SandboxStorageClaimDenial;
}

export interface SandboxStorageClaimInput extends SandboxStorageScope {
  /**
   * Whether this run is an Agent Share visitor's. Required rather than optional:
   * such a run executes under the CREATOR's identity, so every input this
   * function reads — the plan, the key — describes the creator, not the
   * person at the keyboard. Issuing a claim would hand a visitor the
   * creator's working directory, with everything their other conversations left
   * in it, to read and overwrite. Making the caller state it means a new call
   * site cannot inherit the dangerous answer by saying nothing.
   */
  isShareVisitorRun: boolean;
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
 * 3. Their plan entitles them to storage. A deployment without the business
 *    slot entitles nobody, so self-hosting never reaches the drive.
 *
 * Returns `null` for "no persistent workspace", which is the shape the
 * execution plane reads as free tier. Without a claim its routing sends the run
 * to the ephemeral sandbox no matter what mode the request asks for, so this is
 * the single gate for the whole feature: nothing a client sends can open it.
 *
 * Never throws: a subscription lookup that fails must not take the sandbox
 * down with it. The run degrades to an ephemeral sandbox, which is
 * what every session does today, and the lookup is left alone for a moment
 * rather than asked again by every tool call.
 */
export const resolveSandboxStorageClaimResult = async ({
  drive,
  isShareVisitorRun,
  userId,
  workspaceId,
}: SandboxStorageClaimInput): Promise<SandboxStorageClaimResult> => {
  if (isShareVisitorRun) return { claim: null, denial: 'shareVisitor' };

  // The drive picks the key and nothing else: a workspace's public drive and
  // every member's personal drive draw on the workspace plan's one pool, so
  // each is issued the whole pool as its soft quota and the execution plane
  // judges the workspace on their sum.
  const key = deriveSandboxStorageKey({ drive, userId, workspaceId });
  if (!key) return { claim: null, denial: 'noStorageKey' };

  if (lookupFailures.isCoolingDown(key)) return { claim: null, denial: 'lookupBackoff' };

  try {
    const entitlement = await resolveSandboxStorageEntitlement({ userId, workspaceId });
    const quotaBytes = entitlement?.quotaBytes;
    if (typeof quotaBytes !== 'number' || !Number.isSafeInteger(quotaBytes) || quotaBytes <= 0) {
      return { claim: null, denial: 'notEntitled' };
    }

    // Only when true. An entitlement that says nothing about overage means the
    // quota is a hard limit — the reading that cannot bill anyone by accident.
    return {
      claim: entitlement?.overageAllowed
        ? { key, overageAllowed: true, quotaBytes }
        : { key, quotaBytes },
    };
  } catch (error) {
    log('Failed to resolve the sandbox workspace entitlement for %s: %O', key, error);
    warnSandboxDegraded('entitlement', { drive, key, reason: 'lookupFailed' }, error);
    lookupFailures.record(key);
    return { claim: null, denial: 'lookupFailed' };
  }
};

/** {@link resolveSandboxStorageClaimResult} for a caller that only needs the claim. */
export const resolveSandboxStorageClaim = async (
  input: SandboxStorageClaimInput,
): Promise<SandboxStorageClaim | null> => (await resolveSandboxStorageClaimResult(input)).claim;

/** For tests: forget the lookups that failed. */
export const clearSandboxClaimFailures = () => lookupFailures.clear();
