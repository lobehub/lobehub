import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  assertWorkspaceOwner,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from './_workspaceControl';

const topUpProcedure = authedProcedure.use(serverDatabase);

export const topUpRouter = router({
  create: topUpProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        note: z.string().optional(),
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);
      const settings = await getWorkspaceSettings(ctx, input.workspaceId);
      const balance = Number(settings.creditBalance ?? 0) + input.amount;
      const ledger = Array.isArray(settings.creditLedger) ? settings.creditLedger : [];

      await updateWorkspaceSettings(ctx, input.workspaceId, {
        creditBalance: balance,
        creditCurrency: 'tokens',
        creditInitialized: true,
        creditLedger: [
          ...ledger,
          {
            amount: input.amount,
            at: new Date().toISOString(),
            balanceAfter: balance,
            note: input.note,
            type: 'top_up',
            userId: ctx.userId,
          },
        ],
      });

      return { balance };
    }),
});
