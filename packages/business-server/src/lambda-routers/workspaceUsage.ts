import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';

export interface WorkspaceCurrentUsage {
  remainingBalance: number;
  since: string | null;
  subscription: { plan?: string; status?: string } | null;
  until: string | null;
  usageByType: { spend: number; type: string }[];
}

// Cloud overrides this at the same path with the real workspaceUsageRouter.
export const workspaceUsageRouter = router({
  getCurrentUsage: wsCompatProcedure
    .input(z.object({ since: z.string().optional(), until: z.string().optional() }).optional())
    .query(async (): Promise<WorkspaceCurrentUsage> => ({
      remainingBalance: 0,
      since: null,
      subscription: null,
      until: null,
      usageByType: [],
    })),
});
