import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  assertWorkspaceMember,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from './_workspaceControl';

const spendProcedure = authedProcedure.use(serverDatabase);

export const spendRouter = router({
  record: spendProcedure
    .input(z.object({ amount: z.number().positive(), reason: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId);
      const settings = await getWorkspaceSettings(ctx, input.workspaceId);
      const current = Number(settings.creditBalance ?? 0);
      const balance = Math.max(0, current - input.amount);
      const ledger = Array.isArray(settings.creditLedger) ? settings.creditLedger : [];

      await updateWorkspaceSettings(ctx, input.workspaceId, {
        creditBalance: balance,
        creditLedger: [
          ...ledger,
          {
            amount: -input.amount,
            at: new Date().toISOString(),
            reason: input.reason,
            type: 'spend',
            userId: ctx.userId,
          },
        ],
      });

      return { balance };
    }),
});
