import type {
  HeteroPermissionMode,
  HeteroPermissionModeDir,
  WorkspaceUserPreference,
} from '@lobechat/types';
import {
  applyHeteroPermissionModeDir,
  applyHeteroPlanModeDir,
  applyWorktreeModeDir,
} from '@lobechat/types';
import { mergeNotificationSettings } from '@lobechat/utils/mergeNotificationSettings';
import { and, eq, isNull } from 'drizzle-orm';

import { MAX_PINNED_ORDER_ITEMS } from '../repositories/home/pinnedOrder';
import { workspaceMembers, workspaceUserSettings } from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';

/**
 * `patch` merged on top of `current`. Top-level keys replace; per-agent and
 * per-item maps merge one level deeper (see the comments inside).
 */
const mergePreferencePatch = (
  current: WorkspaceUserPreference,
  patch: Partial<WorkspaceUserPreference>,
): WorkspaceUserPreference => {
  // Per-agent override maps merge one level deeper: clients patch a single
  // agent's leaf from a local copy that may be stale or empty (for example a
  // picker used before the preference fetch settles). A top-level replace
  // would silently drop this user's choices for every other agent.
  // Individual per-agent entries still replace wholesale.
  return {
    ...current,
    ...patch,
    ...(patch.agentDeviceOverrides
      ? {
          agentDeviceOverrides: {
            ...current.agentDeviceOverrides,
            ...patch.agentDeviceOverrides,
          },
        }
      : {}),
    ...(patch.agentModelOverrides
      ? {
          agentModelOverrides: {
            ...current.agentModelOverrides,
            ...patch.agentModelOverrides,
          },
        }
      : {}),
    ...(patch.notification
      ? { notification: mergeNotificationSettings(current.notification, patch.notification) }
      : {}),
    ...(patch.agentModeOverrides
      ? {
          agentModeOverrides: {
            ...current.agentModeOverrides,
            ...patch.agentModeOverrides,
          },
        }
      : {}),
    ...(patch.sidebarAgentVisibilityOverrides
      ? {
          sidebarAgentVisibilityOverrides: {
            ...current.sidebarAgentVisibilityOverrides,
            ...patch.sidebarAgentVisibilityOverrides,
          },
        }
      : {}),
    // Deprecated, but still merged: the fields stay on the API, so a client
    // from before the shared-sidebar change can still patch a single item.
    // A top-level replace would let one such write shred the rest of that
    // user's saved map — which is exactly the data the deprecation promises
    // to leave intact for a rollback. Drop these two once the fields leave
    // `WorkspaceUserPreference`.
    ...(patch.sidebarGroupAssignments
      ? {
          sidebarGroupAssignments: {
            ...current.sidebarGroupAssignments,
            ...patch.sidebarGroupAssignments,
          },
        }
      : {}),
    ...(patch.sidebarPinnedOverrides
      ? {
          sidebarPinnedOverrides: {
            ...current.sidebarPinnedOverrides,
            ...patch.sidebarPinnedOverrides,
          },
        }
      : {}),
  };
};

/**
 * Per-user preferences scoped to a specific workspace — the workspace-scoped
 * counterpart to `UserSettingsModel`. Rows live in `workspace_user_settings`
 * (PK `(workspaceId, userId)`) and cascade with either identity anchor.
 *
 * Every operation is scoped to the constructor's `(workspaceId, userId)`
 * pair; there is no way to reach another member's preferences through this
 * model, mirroring how the caller can only ever write their own settings from
 * the UI.
 *
 * Rows are lazily created — the first `updatePreference` call for a given
 * pair upserts, so members who never customize anything simply have no row
 * and callers fall through to defaults on read.
 */
export class WorkspaceUserSettingsModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * The caller's preference row for this workspace, or `undefined` when
   * nothing has been saved yet. Callers should treat `undefined` as "no
   * per-user override" and fall back to the shared defaults — the same
   * behaviour a first-open would see before this feature existed.
   */
  get = async () => {
    return this.db.query.workspaceUserSettings.findFirst({
      where: and(
        eq(workspaceUserSettings.workspaceId, this.workspaceId),
        eq(workspaceUserSettings.userId, this.userId),
      ),
    });
  };

  /**
   * The caller's effective preference bag, with defaults applied. Never
   * `undefined` — an unwritten row returns `{}`, so consumers can index into
   * it without null-guarding every field.
   */
  getPreference = async (): Promise<WorkspaceUserPreference> => {
    const row = await this.get();
    return row?.preference ?? {};
  };

  /**
   * Merge `patch` on top of the caller's current preference and persist the
   * result. Read → merge → write runs under the row lock (see
   * {@link mutatePreference}), so it never interleaves with the server's own
   * writes to the same row — for example the one-time sidebar setup on the
   * first read — nor with the caller's other tabs.
   *
   * The first call for a `(workspace, user)` pair creates the row; subsequent
   * calls update the `preference` column in place, replacing the whole jsonb
   * with the newly merged object (so setting a top-level key to `undefined`
   * in the patch is a no-op — pass an explicit `{}` to clear it).
   */
  updatePreference = async (patch: Partial<WorkspaceUserPreference>) =>
    this.mutatePreference((current) => {
      const next = mergePreferencePatch(current, patch);
      return { next, result: { preference: next } };
    });

  /**
   * Turn the composer's "New worktree" switch on or off for one directory and
   * return the stored list. The cap (see `applyWorktreeModeDir`) is enforced
   * here rather than trusted from a client copy that may be stale.
   */
  setWorktreeModeDir = async (key: string, enabled: boolean): Promise<string[]> =>
    this.mutatePreference((current) => {
      const worktreeModeDirs = applyWorktreeModeDir(current.worktreeModeDirs, key, enabled);
      return { next: { ...current, worktreeModeDirs }, result: worktreeModeDirs };
    });

  /**
   * Remember whether this member left the Codex Plan switch on for one
   * directory and return the stored list (capped here, like the worktree switch).
   */
  setHeteroPlanModeDir = async (key: string, enabled: boolean): Promise<string[]> =>
    this.mutatePreference((current) => {
      const heteroPlanModeDirs = applyHeteroPlanModeDir(current.heteroPlanModeDirs, key, enabled);
      return { next: { ...current, heteroPlanModeDirs }, result: heteroPlanModeDirs };
    });

  /**
   * Remember the Claude Code permission mode this member picked for one
   * directory and return the stored list (capped here, like the worktree switch).
   */
  setHeteroPermissionModeDir = async (
    key: string,
    mode: HeteroPermissionMode,
  ): Promise<HeteroPermissionModeDir[]> =>
    this.mutatePreference((current) => {
      const heteroPermissionModeDirs = applyHeteroPermissionModeDir(
        current.heteroPermissionModeDirs,
        key,
        mode,
      );
      return { next: { ...current, heteroPermissionModeDirs }, result: heteroPermissionModeDirs };
    });

  /**
   * When this member joined the workspace, or `undefined` when they are not
   * a member (any more).
   */
  getJoinedAt = async (): Promise<Date | undefined> => {
    const [row] = await this.db
      .select({ joinedAt: workspaceMembers.joinedAt })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, this.workspaceId),
          eq(workspaceMembers.userId, this.userId),
          isNull(workspaceMembers.deletedAt),
        ),
      );
    return row?.joinedAt;
  };

  /**
   * Set this member's sidebar up from the workspace once:
   * - `pinIds` go after the member's own pins (`sidebarPinnedItemIds`), so a
   *   member keeps what they saw: their pins first, then the team's;
   * - `listIds` are added to the sidebar unpinned
   *   (`sidebarAgentVisibilityOverrides`), never overriding a choice the
   *   member already made.
   *
   * The preference is then marked `sidebarInitialized`, after which the
   * sidebar is the member's alone. Nothing happens while both lists are
   * empty, so a member who loads the sidebar before the workspace has
   * anything to offer still gets it later — unless `final` says nothing can
   * ever be added, which marks the member as set up anyway. Returns the
   * stored preference.
   */
  initializeSidebar = async ({
    final = false,
    listIds = [],
    pinIds = [],
  }: {
    final?: boolean;
    listIds?: readonly string[];
    pinIds?: readonly string[];
  }): Promise<WorkspaceUserPreference> => {
    if (!final && listIds.length === 0 && pinIds.length === 0) return this.getPreference();

    return this.mutatePreference((current) => {
      if (current.sidebarInitialized) return { next: current, result: current };

      const next: WorkspaceUserPreference = { ...current, sidebarInitialized: true };
      if (pinIds.length > 0) {
        next.sidebarPinnedItemIds = [
          ...new Set([...(current.sidebarPinnedItemIds ?? []), ...pinIds]),
        ].slice(0, MAX_PINNED_ORDER_ITEMS);
      }
      if (listIds.length > 0) {
        next.sidebarAgentVisibilityOverrides = {
          ...Object.fromEntries(listIds.map((id) => [id, true])),
          ...current.sidebarAgentVisibilityOverrides,
        };
      }
      return { next, result: next };
    });
  };

  /**
   * Read → change → write this member's preference under the row lock. The
   * row is created first when missing: `FOR UPDATE` locks nothing on an
   * absent row, so two first writes would otherwise both read `{}` and the
   * later upsert would drop the earlier one's change.
   */
  private mutatePreference = async <T>(
    change: (current: WorkspaceUserPreference) => { next: WorkspaceUserPreference; result: T },
  ): Promise<T> =>
    this.db.transaction(async (trx) => {
      await trx
        .insert(workspaceUserSettings)
        .values({ preference: {}, userId: this.userId, workspaceId: this.workspaceId })
        .onConflictDoNothing({
          target: [workspaceUserSettings.workspaceId, workspaceUserSettings.userId],
        });
      const [row] = await trx
        .select({ preference: workspaceUserSettings.preference })
        .from(workspaceUserSettings)
        .where(
          and(
            eq(workspaceUserSettings.workspaceId, this.workspaceId),
            eq(workspaceUserSettings.userId, this.userId),
          ),
        )
        .for('update');
      const { next, result } = change(row?.preference ?? {});
      await trx
        .insert(workspaceUserSettings)
        .values({ preference: next, userId: this.userId, workspaceId: this.workspaceId })
        .onConflictDoUpdate({
          set: { preference: next, updatedAt: new Date() },
          target: [workspaceUserSettings.workspaceId, workspaceUserSettings.userId],
        });
      return result;
    });
}
