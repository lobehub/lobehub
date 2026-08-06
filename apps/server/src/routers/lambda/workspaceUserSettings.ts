import type { WorkspaceUserPreference } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

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

export const workspaceUserSettingsRouter = router({
  /**
   * Fetch the caller's preference for the current workspace. Returns an
   * empty object when no row has been written yet — consumers should treat
   * that as "use defaults".
   */
  getPreference: workspaceUserSettingsProcedure.query(
    async ({ ctx }): Promise<WorkspaceUserPreference> => {
      try {
        return await ctx.workspaceUserSettingsModel.getPreference();
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
        const canOrganize = await hasWorkspaceScopedPermission({
          action: 'AGENT_UPDATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        if (canOrganize) {
          const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
          for (const [agentId, groupId] of Object.entries(legacyAssignments)) {
            try {
              await agentModel.updateSessionGroupId(agentId, groupId ?? null);
            } catch (error) {
              // Best-effort per entry: a vanished folder or a visibility
              // mismatch must not fail the preference write itself.
              console.warn(
                `[workspaceUserSettings] skipped legacy sidebar assignment for ${agentId}:`,
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
