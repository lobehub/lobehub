import { publicProcedure, router } from '@/libs/trpc/lambda';

export const klavisRouter = router({
  /**
   * Legacy compatibility for clients released before the Klavis to Composio migration.
   */
  getKlavisPlugins: publicProcedure.query(() => []),
});

export type KlavisRouter = typeof klavisRouter;
