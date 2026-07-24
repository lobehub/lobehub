import type { WorkspaceUserPreference } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { workspaceUserSettings } from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';

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
   * result via UPSERT. The merge is done at the application layer (read →
   * merge → write) because only the caller writes their own row, so the
   * lost-update surface is limited to the same user racing themselves in
   * multiple tabs — an acceptable trade for simple code.
   *
   * The first call for a `(workspace, user)` pair creates the row; subsequent
   * calls update the `preference` column in place, replacing the whole jsonb
   * with the newly merged object (so setting a top-level key to `undefined`
   * in the patch is a no-op — pass an explicit `{}` to clear it).
   */
  updatePreference = async (patch: Partial<WorkspaceUserPreference>) => {
    const current = (await this.getPreference()) ?? {};
    // Per-agent override maps merge one level deeper: clients patch a single
    // agent's leaf from a local copy that may be stale or empty (for example a
    // picker used before the preference fetch settles). A top-level replace
    // would silently drop this user's choices for every other agent.
    // Individual per-agent entries still replace wholesale.
    const next: WorkspaceUserPreference = {
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
      ...(patch.agentModeOverrides
        ? {
            agentModeOverrides: {
              ...current.agentModeOverrides,
              ...patch.agentModeOverrides,
            },
          }
        : {}),
    };
    const [row] = await this.db
      .insert(workspaceUserSettings)
      .values({
        preference: next,
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .onConflictDoUpdate({
        set: { preference: next, updatedAt: new Date() },
        target: [workspaceUserSettings.workspaceId, workspaceUserSettings.userId],
      })
      .returning();
    return row;
  };
}
