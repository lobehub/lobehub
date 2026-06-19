import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  assertWorkspaceMember,
  assertWorkspaceOwner,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from './_workspaceControl';

const creditsProcedure = authedProcedure.use(serverDatabase);

export const workspaceCreditsRouter = router({
  getBalance: creditsProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId);
      const settings = await getWorkspaceSettings(ctx, input.workspaceId);

      return {
        balance: Number(settings.creditBalance ?? 0),
        currency: String(settings.creditCurrency ?? 'internal'),
      };
    }),

  setBalance: creditsProcedure
    .input(z.object({ balance: z.number().min(0), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);
      await updateWorkspaceSettings(ctx, input.workspaceId, { creditBalance: input.balance });
    }),
});
