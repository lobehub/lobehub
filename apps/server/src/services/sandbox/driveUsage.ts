import {
  deriveSandboxStorageKey,
  type SandboxDrive,
  type SandboxStorageClaim,
} from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';
import { and, eq, isNull } from 'drizzle-orm';
import pMap from 'p-map';

import { users, workspaceMembers } from '@/database/schemas';
import { MarketService } from '@/server/services/market';

import type { DriveAccess } from './driveAccess';

/** Roles that may see how much each member's personal drive holds — never what. */
const USAGE_ADMIN_ROLES = new Set(['admin', 'owner']);

export interface MemberDriveUsage {
  avatar: string | null;
  name: string | null;
  usageBytes: number | null;
  userId: string;
}

interface ReadDriveUsageInput {
  /** The caller's claim for the drive the call named; its quota is the pool's. */
  claim: SandboxStorageClaim;
  drives: DriveAccess;
  role?: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * How much each of the caller's drives holds against the plan's quota.
 *
 * A workspace's public drive and every member's personal drive draw on one
 * pool, so the figure that decides whether a write is refused is their sum —
 * the execution plane reports it beside each drive's own. An owner or admin is
 * also shown how much each other member's personal drive holds: the amount,
 * which is the workspace's to pay for, and never the contents. The claim used
 * to read a member's figure goes to the storage-info read alone; no listing,
 * read or write is ever made with it.
 */
export const readDriveUsage = async ({
  claim,
  drives: access,
  role,
  serverDB,
  userId,
  workspaceId,
}: ReadDriveUsageInput) => {
  const seesMembers = !!workspaceId && !!role && USAGE_ADMIN_ROLES.has(role);

  // For an owner or admin the public drive's read also lists every drive in
  // the pool, so the members' figures come from that one call.
  const read = async (drive: SandboxDrive) => {
    const resolved = await access.client(drive);
    if (!resolved) return null;

    return resolved.client
      .getStorage({ withDrives: seesMembers && drive === 'public' })
      .catch(() => null);
  };

  const drives = await pMap(
    access.available,
    async (drive) => ({ drive, info: await read(drive) }),
    { concurrency: 5 },
  );
  const reported = drives.find((entry) => entry.info?.workspaceUsageBytes != null)?.info;

  let members: MemberDriveUsage[] | null = null;
  if (workspaceId && seesMembers) {
    const rows = await serverDB
      .select({
        avatar: users.avatar,
        fullName: users.fullName,
        userId: workspaceMembers.userId,
        username: users.username,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)),
      );

    const others = rows.filter((row) => row.userId !== userId);
    const describe = (row: (typeof others)[number], usageBytes: number | null) => ({
      avatar: row.avatar ?? null,
      name: row.fullName || row.username || null,
      usageBytes,
      userId: row.userId,
    });
    const keyOf = (memberId: string) =>
      deriveSandboxStorageKey({ drive: 'personal', userId: memberId, workspaceId });

    const pooled = drives.find((entry) => entry.drive === 'public')?.info?.workspaceDrives;
    if (pooled) {
      // One read answered for the whole pool. A member with no row there has
      // never had a session on their drive, so nothing was ever measured.
      const usageByKey = new Map(pooled.map((entry) => [entry.storageKey, entry.usageBytes]));
      members = others.map((row) => {
        const key = keyOf(row.userId);
        return describe(row, key ? (usageByKey.get(key) ?? null) : null);
      });
    } else {
      // An execution plane that cannot list the pool: one read per member,
      // bounded, since a workspace can be large.
      members = await pMap(
        others,
        async (row) => {
          const key = keyOf(row.userId);
          const info = key
            ? await new MarketService({
                userInfo: {
                  sandboxStorage: { key, quotaBytes: claim.quotaBytes },
                  userId,
                  workspaceId,
                },
              })
                .getSandboxStorageClient()
                .getStorage()
                .catch(() => null)
            : null;

          return describe(row, info?.usageBytes ?? null);
        },
        { concurrency: 5 },
      );
    }
  }

  const measured = [
    ...drives.map((entry) => entry.info?.usageBytes),
    ...(members ?? []).map((member) => member.usageBytes),
  ].filter((value): value is number => typeof value === 'number');

  return {
    drives: drives.map(({ drive, info }) => ({
      drive,
      usageBytes: info?.usageBytes ?? null,
      usageCheckedAt: info?.usageCheckedAt ?? null,
    })),
    members,
    /** Whether the plan lets writes go past the quota, billed as overage. */
    overageAllowed: claim.overageAllowed === true,
    quotaBytes: claim.quotaBytes,
    /**
     * The pool's total as the execution plane judges it, or — when it has not
     * said — what this caller can add up from the drives it can see.
     */
    totalUsageBytes:
      reported?.workspaceUsageBytes ??
      (measured.length > 0 ? measured.reduce((sum, value) => sum + value, 0) : null),
  };
};
