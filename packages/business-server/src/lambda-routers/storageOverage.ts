import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  assertWorkspaceMember,
  assertWorkspaceOwner,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from './_workspaceControl';

const storageProcedure = authedProcedure.use(serverDatabase);

export const storageOverageRouter = router({
  getPolicy: storageProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId);
      const settings = await getWorkspaceSettings(ctx, input.workspaceId);

      return {
        hardLimitBytes: Number(settings.storageHardLimitBytes ?? 100 * 1024 * 1024 * 1024),
        overageEnabled: Boolean(settings.storageOverageEnabled ?? false),
      };
    }),

  updatePolicy: storageProcedure
    .input(
      z.object({
        hardLimitBytes: z.number().positive(),
        overageEnabled: z.boolean(),
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);
      await updateWorkspaceSettings(ctx, input.workspaceId, {
        storageHardLimitBytes: input.hardLimitBytes,
        storageOverageEnabled: input.overageEnabled,
      });
    }),
});
