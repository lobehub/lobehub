import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import {
  assertWorkspaceMember,
  assertWorkspaceOwner,
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type WorkspaceControlContext,
} from './_workspaceControl';

const creditsProcedure = authedProcedure.use(serverDatabase);
const STARTER_WORKSPACE_CREDITS = 100_000;

const ensureWorkspaceCredits = async (ctx: WorkspaceControlContext, workspaceId: string) => {
  const settings = await getWorkspaceSettings(ctx, workspaceId);
  if (settings.creditInitialized) return settings;

  const nextSettings = {
    ...settings,
    creditBalance: STARTER_WORKSPACE_CREDITS,
    creditCurrency: 'tokens',
    creditInitialized: true,
    creditLedger: [
      ...(Array.isArray(settings.creditLedger) ? settings.creditLedger : []),
      {
        amount: STARTER_WORKSPACE_CREDITS,
        at: new Date().toISOString(),
        balanceAfter: STARTER_WORKSPACE_CREDITS,
        type: 'starter_grant',
      },
    ],
  };
  await updateWorkspaceSettings(ctx, workspaceId, nextSettings);

  return nextSettings;
};

export const workspaceCreditsRouter = router({
  getBalance: creditsProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId);
      const settings = await ensureWorkspaceCredits(ctx, input.workspaceId);

      return {
        balance: Number(settings.creditBalance ?? 0),
        currency: String(settings.creditCurrency ?? 'tokens'),
      };
    }),

  setBalance: creditsProcedure
    .input(z.object({ balance: z.number().min(0), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceOwner(ctx, input.workspaceId);
      const settings = await getWorkspaceSettings(ctx, input.workspaceId);
      await updateWorkspaceSettings(ctx, input.workspaceId, {
        creditBalance: input.balance,
        creditCurrency: 'tokens',
        creditInitialized: true,
        creditLedger: [
          ...(Array.isArray(settings.creditLedger) ? settings.creditLedger : []),
          {
            actorUserId: ctx.userId,
            amount: input.balance - Number(settings.creditBalance ?? 0),
            at: new Date().toISOString(),
            balanceAfter: input.balance,
            type: 'owner_set_balance',
          },
        ],
      });
    }),
});
