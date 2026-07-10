import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';

// Cloud overrides this at the same path with the real workspaceRouter backed by cloudDB.
// Only the procedures consumed by submodule (open-source) UI are declared here as
// typed no-op stubs so the contract type-checks; cloud supplies the real implementations.
export const workspaceRouter = router({
  ensureMarketOrganization: authedProcedure
    .input(z.object({ autoProvision: z.boolean().optional() }).optional())
    .mutation(async (): Promise<{ created: boolean; marketAccountId: number }> => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Workspace market organization is a cloud-only feature.',
      });
    }),
});
