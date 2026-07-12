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
    // `agentDeviceOverrides` merges per source device, not per agent. Clients
    // patch a single agent's override built from their LOCAL copy of the
    // per-source map, which may be stale or partial (e.g. the picker was opened
    // before the preference fetch settled, or another tab saved a different
    // source device). A shallow per-agent replace would silently drop this
    // user's saved choices for *other* source devices, breaking the per-source
    // isolation. So merge one level deeper: each agent's source map is combined
    // key-by-key with what's already persisted.
    const next: WorkspaceUserPreference = {
      ...current,
      ...patch,
      ...(patch.agentDeviceOverrides
        ? {
            agentDeviceOverrides: {
              ...current.agentDeviceOverrides,
              ...Object.fromEntries(
                Object.entries(patch.agentDeviceOverrides).map(([agentId, bySource]) => {
                  // Normalize a legacy flat override (`{ executionTarget,
                  // boundDeviceId }`) into the per-source map shape before
                  // merging, so it doesn't shadow the new keyed entry — the
                  // resolver treats any object with top-level executionTarget /
                  // boundDeviceId as legacy flat and returns it as-is, skipping
                  // source keys.
                  const existing = current.agentDeviceOverrides?.[agentId];
                  const normalizedExisting =
                    existing && ('executionTarget' in existing || 'boundDeviceId' in existing)
                      ? { '*': existing }
                      : existing;
                  return [agentId, { ...normalizedExisting, ...bySource }];
                }),
              ),
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
