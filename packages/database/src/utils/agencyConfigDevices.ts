import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import { devices } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

/**
 * Collect device ids that an incoming `agencyConfig` patch is *setting*
 * (not clearing). `workingDirByDevice` entries with `undefined` value are
 * deletes (per `pruneWorkingDirByDeviceDeletes`) and are skipped.
 */
export const collectBoundDeviceIds = (
  agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
): string[] => {
  if (!agencyConfig) return [];
  const ids: string[] = [];
  const bound = agencyConfig.boundDeviceId;
  if (typeof bound === 'string' && bound) ids.push(bound);
  const map = agencyConfig.workingDirByDevice;
  if (map) {
    for (const [deviceId, cwd] of Object.entries(map)) {
      if (cwd === undefined) continue;
      ids.push(deviceId);
    }
  }
  return ids;
};

/**
 * Strip device bindings that are not enrolled in `targetWorkspaceId`, and
 * downgrade `fixed` device execution targets that can no longer be resolved.
 * Any `boundDeviceId` / `workingDirByDevice` entry pointing outside the
 * target workspace is dropped, and a `fixed` device target without a valid
 * public device is downgraded to `member` (defaulting to the caller's own
 * device). Shared by every ownership-rehoming path (moving a row into a
 * workspace, duplicating into one, member and group handovers): a leftover
 * reference to a device only the previous owner can reach would otherwise
 * point the re-homed agent at a target nobody else can resolve.
 *
 * `viewerUserId` — when the row is being re-homed to a specific new owner,
 * pass that owner: a workspace device with `private` visibility is only
 * usable by its enrolling member, so bindings to someone ELSE's private
 * device are dropped for the new owner as well.
 */
export const sanitizeAgencyConfigsForWorkspace = async (
  db: LobeChatDatabase | Transaction,
  targetWorkspaceId: string,
  agencyConfigs: Array<LobeAgentAgencyConfig | null | undefined>,
  options?: { viewerUserId?: string },
): Promise<Array<LobeAgentAgencyConfig | null>> => {
  const viewerUserId = options?.viewerUserId;
  const allCandidateIds = [
    ...new Set(agencyConfigs.flatMap((config) => collectBoundDeviceIds(config))),
  ];
  const deviceRows =
    allCandidateIds.length > 0
      ? await db
          .select({
            deviceId: devices.deviceId,
            userId: devices.userId,
            visibility: devices.visibility,
          })
          .from(devices)
          .where(
            and(
              eq(devices.workspaceId, targetWorkspaceId),
              inArray(devices.deviceId, allCandidateIds),
            ),
          )
      : [];
  const visibleRows = viewerUserId
    ? deviceRows.filter((r) => r.visibility === 'public' || r.userId === viewerUserId)
    : deviceRows;
  const allowed = new Set(visibleRows.map((r) => r.deviceId));
  const publicDeviceIds = new Set(
    visibleRows.filter((r) => r.visibility === 'public').map((r) => r.deviceId),
  );

  return agencyConfigs.map((config) => {
    let next: LobeAgentAgencyConfig | null = config ?? null;
    if (!next) return next;

    const candidateIds = collectBoundDeviceIds(next);
    if (candidateIds.length > 0) {
      const cleaned: LobeAgentAgencyConfig = { ...next };
      if (cleaned.boundDeviceId && !allowed.has(cleaned.boundDeviceId)) {
        delete cleaned.boundDeviceId;
      }
      if (cleaned.workingDirByDevice) {
        const filtered: Record<string, string> = {};
        for (const [deviceId, cwd] of Object.entries(cleaned.workingDirByDevice)) {
          if (allowed.has(deviceId) && typeof cwd === 'string') filtered[deviceId] = cwd;
        }
        cleaned.workingDirByDevice = Object.keys(filtered).length > 0 ? filtered : undefined;
      }
      if (
        cleaned.executionTargetSelectionPolicy === 'fixed' &&
        cleaned.executionTarget === 'device' &&
        (!cleaned.boundDeviceId || !allowed.has(cleaned.boundDeviceId))
      ) {
        cleaned.executionTargetSelectionPolicy = 'member';
      }
      next = cleaned;
    }

    if (
      next.executionTargetSelectionPolicy === 'fixed' &&
      (!next.executionTarget ||
        !['auto', 'device', 'none', 'sandbox'].includes(next.executionTarget))
    ) {
      next.executionTargetSelectionPolicy = 'member';
    }

    if (
      next.executionTargetSelectionPolicy === 'fixed' &&
      next.executionTarget === 'device' &&
      (!next.boundDeviceId || !publicDeviceIds.has(next.boundDeviceId))
    ) {
      next.executionTargetSelectionPolicy = 'member';
    }

    return next;
  });
};
