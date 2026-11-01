import {
  SANDBOX_DRIVES,
  type SandboxDrive,
  sandboxDriveOfKey,
  type SandboxStorageClaim,
} from '@lobechat/builtin-tool-cloud-sandbox';

import { MarketService } from '@/server/services/market';

import type { resolveSandboxStorageClaim } from './entitlement';

interface DriveAccessInput {
  /** Handed in rather than imported, so a caller's own seam for it is the one used. */
  resolveClaim: typeof resolveSandboxStorageClaim;
  userId: string;
  workspaceId?: string;
}

/**
 * One caller's drives, each claim resolved at most once per request.
 *
 * Personal drives are the caller's own and nobody else's: there is no way to
 * ask this for another member's, which is what keeps one member's personal
 * drive out of every other member's reach — they would need a claim for its
 * key, and nothing built on this issues one.
 */
export const createDriveAccess = ({ resolveClaim, userId, workspaceId }: DriveAccessInput) => {
  const claims = new Map<SandboxDrive, Promise<SandboxStorageClaim | null>>();

  const claim = (drive: SandboxDrive) => {
    const cached = claims.get(drive);
    if (cached) return cached;

    const pending = resolveClaim({
      drive,
      isShareVisitorRun: false,
      userId,
      workspaceId,
    });
    claims.set(drive, pending);

    return pending;
  };

  return {
    /** The drives this caller has: both in a workspace, the one otherwise. */
    available: (workspaceId ? [...SANDBOX_DRIVES] : ['personal']) as SandboxDrive[],
    claim,
    client: async (drive: SandboxDrive) => {
      const resolved = await claim(drive);

      return resolved
        ? {
            claim: resolved,
            client: new MarketService({
              userInfo: { sandboxStorage: resolved, userId, workspaceId },
            }).getSandboxStorageClient(),
          }
        : undefined;
    },
    /** Which of the caller's drives a storage key is, or `undefined` for none of theirs. */
    driveOf: (key: string | null | undefined) =>
      key ? sandboxDriveOfKey(key, { userId, workspaceId }) : undefined,
  };
};

export type DriveAccess = ReturnType<typeof createDriveAccess>;
