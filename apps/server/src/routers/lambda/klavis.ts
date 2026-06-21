import { authedProcedure, router } from '@/libs/trpc/lambda';

export const klavisRouter = router({
  /**
   * Legacy compatibility for clients released before the Klavis to Composio migration.
   */
  getKlavisPlugins: authedProcedure.query(() => []),
});

export type KlavisRouter = typeof klavisRouter;
