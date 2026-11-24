import { hasApiKeyScope, isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import type { WorkspaceUserPreference } from '@lobechat/types';
import { HETERO_PERMISSION_MODES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import { HomeRepository } from '@/database/repositories/home';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { EditLockService } from '@/server/services/editLock';
import { assertCanEditResource } from '@/server/services/resourcePermission';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

import { TEAM_PINS_RETIRED_AT } from './_helpers/sidebarPin';

/**
 * Per-user preferences scoped to the current workspace. Every procedure is
 * scoped to `(ctx.workspaceId, ctx.userId)` — the caller can only ever read
 * or write their own row. Personal mode (`ctx.workspaceId` is null) rejects
 * every call: this is workspace-mode data by construction.
 */
const workspaceUserSettingsProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  if (!ctx.workspaceId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'workspace_user_settings is workspace-scoped; no workspace on this request',
    });
  }
  return opts.next({
    ctx: {
      // re-declare with the narrowed type so downstream procedures see a
      // guaranteed string instead of the compat middleware's nullable field
      workspaceId: ctx.workspaceId,
      workspaceUserSettingsModel: new WorkspaceUserSettingsModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId,
      ),
    },
  });
});

// Kept loose (`.passthrough().partial()`) so a future field addition to
// `WorkspaceUserPreference` doesn't need a coupled zod-schema bump — the
// type layer already constrains the write paths.
const preferencePatchSchema = z.object({}).passthrough().partial();

/**
 * Set a member's sidebar up from the workspace the first time their
 * preference is read (lazy, so every way of joining a workspace is covered):
 *
 * - A member who joined while team pins were shown
 *   ({@link TEAM_PINS_RETIRED_AT}) keeps them as their own pins, after the
 *   pins they already had — nothing they saw disappears.
 * - Anyone else gets the workspace's recommended Agents added to their
 *   sidebar, unpinned.
 *
 * A failure only logs: the sidebar then shows the member's own choices and
 * the next read tries again.
 */
const initializeSidebar = async (
  ctx: {
    serverDB: LobeChatDatabase;
    userId: string;
    workspaceId: string;
    workspaceUserSettingsModel: WorkspaceUserSettingsModel;
  },
  preference: WorkspaceUserPreference,
): Promise<WorkspaceUserPreference> => {
  try {
    const joinedAt = await ctx.workspaceUserSettingsModel.getJoinedAt();
    if (!joinedAt) return preference;

    const homeRepository = new HomeRepository(ctx.serverDB, ctx.userId, ctx.workspaceId);
    if (joinedAt < TEAM_PINS_RETIRED_AT) {
      // Settled even without team pins: such a member never gets the
      // recommended list, so a later read has nothing to add.
      const pinIds = await homeRepository.getTeamPinnedIds();
      return await ctx.workspaceUserSettingsModel.initializeSidebar({ final: true, pinIds });
    }

    const listIds = await homeRepository.getRecommendedIds();
    return await ctx.workspaceUserSettingsModel.initializeSidebar({ listIds });
  } catch (error) {
    console.error('[workspaceUserSettings:initializeSidebar]', error);
    return preference;
  }
};

export const workspaceUserSettingsRouter = router({
  /**
   * Fetch the caller's preference for the current workspace. Returns an
   * empty object when no row has been written yet — consumers should treat
   * that as "use defaults".
   */
  getPreference: workspaceUserSettingsProcedure.query(
    async ({ ctx }): Promise<WorkspaceUserPreference> => {
      try {
        const preference = await ctx.workspaceUserSettingsModel.getPreference();
        if (preference.sidebarInitialized) return preference;

        return await initializeSidebar(ctx, preference);
      } catch (error) {
        console.error('[workspaceUserSettings:getPreference]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load workspace user settings',
        });
      }
    },
  ),

  /**
   * This member's "New worktree" switch for one directory in this workspace.
   * The list's cap is applied server-side, against the stored copy.
   */
  setWorktreeModeDir: workspaceUserSettingsProcedure
    .input(z.object({ enabled: z.boolean(), key: z.string().min(1).max(4096) }))
    .mutation(async ({ ctx, input }) =>
      ctx.workspaceUserSettingsModel.setWorktreeModeDir(input.key, input.enabled),
    ),

  /** Whether this member last left the Codex Plan switch on for one directory. */
  setHeteroPlanModeDir: workspaceUserSettingsProcedure
    .input(z.object({ enabled: z.boolean(), key: z.string().min(1).max(4096) }))
    .mutation(async ({ ctx, input }) =>
      ctx.workspaceUserSettingsModel.setHeteroPlanModeDir(input.key, input.enabled),
    ),

  /** The Claude Code permission mode this member last picked for one directory. */
  setHeteroPermissionModeDir: workspaceUserSettingsProcedure
    .input(z.object({ key: z.string().min(1).max(4096), mode: z.enum(HETERO_PERMISSION_MODES) }))
    .mutation(async ({ ctx, input }) =>
      ctx.workspaceUserSettingsModel.setHeteroPermissionModeDir(input.key, input.mode),
    ),

  /**
   * Merge `input` on top of the caller's current preference and persist via
   * UPSERT. First call for a `(workspace, user)` pair creates the row.
   */
  updatePreference: workspaceUserSettingsProcedure
    .input(preferencePatchSchema)
    .mutation(async ({ ctx, input }) => {
      // Compat for pre-shared-sidebar clients: their "Move to Category" still
      // patches the deprecated per-member `sidebarGroupAssignments` map here,
      // which the sidebar no longer reads — so for as long as such a bundle
      // stays open (long-lived web tabs, older desktop builds) every move
      // succeeds server-side yet visibly does nothing. Translate each entry
      // into the shared `agents.sessionGroupId` write a current client sends,
      // under the same role gate as `home.updateAgentSessionGroupId`.
      const legacyAssignments = (input as Partial<WorkspaceUserPreference>).sidebarGroupAssignments;
      if (legacyAssignments && Object.keys(legacyAssignments).length > 0) {
        // the legacy move path writes agent/chat-group organization — a
        // restricted key needs `agent:write` beyond the namespace's
        // `workspace:write`, matching `home.updateAgentSessionGroupId`
        if (
          ctx.apiKeyScopes !== undefined &&
          !isFullAccessApiKey(ctx.apiKeyScopes) &&
          !hasApiKeyScope(ctx.apiKeyScopes, 'agent:write')
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              "This API key cannot move sidebar agents ('sidebarGroupAssignments'): missing required scope 'agent:write'.",
          });
        }
        const canOrganize = await hasWorkspaceScopedPermission({
          action: 'AGENT_UPDATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        if (canOrganize) {
          const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
          const chatGroupModel = new ChatGroupModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
          const editLockService = new EditLockService(ctx.userId);
          for (const [itemId, groupId] of Object.entries(legacyAssignments)) {
            try {
              // The legacy map keys generic sidebar item ids: agents move via
              // `agents.sessionGroupId`, chat groups via `chat_groups.groupId`.
              if (itemId.startsWith('cg_')) {
                // Same per-resource gate as `agentGroup.updateGroup` — the
                // workspace-wide organize grant alone must not allow editing a
                // group whose General Access is view/use only.
                await assertCanEditResource({
                  db: ctx.serverDB,
                  resourceId: itemId,
                  resourceType: 'agentGroup',
                  userId: ctx.userId,
                  workspaceId: ctx.workspaceId,
                });
                // Mirror `agentGroup.updateGroup`'s collaborative edit lock:
                // skip the move while another member actively edits the group.
                const blockedBy = await editLockService.getBlockingHolder('chatGroup', itemId);
                if (blockedBy) throw new Error('Group is being edited by another user');
                await chatGroupModel.update(itemId, { groupId: groupId ?? null });
              } else {
                await agentModel.updateSessionGroupId(itemId, groupId ?? null);
              }
            } catch (error) {
              // Best-effort per entry: a vanished folder or a visibility
              // mismatch must not fail the preference write itself.
              console.warn(
                `[workspaceUserSettings] skipped legacy sidebar assignment for ${itemId}:`,
                error,
              );
            }
          }
        }
      }

      try {
        const row = await ctx.workspaceUserSettingsModel.updatePreference(
          input as Partial<WorkspaceUserPreference>,
        );
        return { data: row?.preference ?? {}, message: 'Updated', success: true };
      } catch (error) {
        console.error('[workspaceUserSettings:updatePreference]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update workspace user settings',
        });
      }
    }),
});
