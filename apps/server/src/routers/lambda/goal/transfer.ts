import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { businessFileTransferStorageCheck } from '@/business/server/lambda-routers/file';
import { FileModel } from '@/database/models/file';
import { router } from '@/libs/trpc/lambda';
import { GoalCopyService } from '@/server/services/goal/copy';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { goalWriteProcedure, mapGoalError } from '../goalProcedures';

export const transferRouter = router({
  /**
   * Copy a goal's definition into personal or another workspace. Moving is
   * intentionally not offered, for the same reason tasks only copy: a goal
   * drags its graph Tasks and their history with it. Permissions match
   * `copyTaskToWorkspace`: `agent:update` in the source scope and
   * `AGENT_UPDATE` on the target workspace; personal needs no target check.
   * Fixture documents and files are copied too, so they need the same target
   * permissions and storage headroom as copying them directly.
   */
  copyGoalToWorkspace: goalWriteProcedure
    .input(z.object({ id: z.string(), targetWorkspaceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const { targetWorkspaceId } = input;
      const service = new GoalCopyService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

      try {
        const fixtures = await service.fixtureResources(input.id);

        if (targetWorkspaceId) {
          const actions = [
            'AGENT_UPDATE' as const,
            ...(fixtures.documentIds.length > 0 ? (['DOCUMENT_CREATE'] as const) : []),
            ...(fixtures.files.length > 0 ? (['FILE_UPLOAD'] as const) : []),
          ];
          for (const action of actions) {
            const canWriteTarget = await hasWorkspaceScopedPermission({
              action,
              db: ctx.serverDB,
              userId: ctx.userId,
              workspaceId: targetWorkspaceId,
            });
            if (!canWriteTarget) {
              throw new TRPCError({
                cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
                code: 'FORBIDDEN',
                message: 'No write access to target workspace',
              });
            }
          }
        }

        if (fixtures.files.length > 0) {
          await businessFileTransferStorageCheck({
            additionalSize: await FileModel.sumAddedStorageBytes(
              ctx.serverDB,
              { userId: ctx.userId, workspaceId: targetWorkspaceId },
              fixtures.files.map((file) => file.id),
            ),
            targetUserId: ctx.userId,
            targetWorkspaceId,
          });
        }

        return await service.copyToWorkspace(input.id, targetWorkspaceId);
      } catch (error) {
        mapGoalError(error, 'copy');
      }
    }),
});
