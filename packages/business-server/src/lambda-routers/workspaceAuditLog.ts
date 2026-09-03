import type { WorkspaceAuditLogItem } from '@lobechat/database/schemas';
import { z } from 'zod';

import {
  requireWorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';

// Cloud overrides this at the same path with the real workspaceAuditLogRouter.
export const workspaceAuditLogRouter = router({
  list: wsCompatProcedure
    .use(requireWorkspaceRole('admin'))
    .input(
      z
        .object({
          action: z.string().optional(),
          cursor: z.string().optional(),
          endDate: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          q: z.string().optional(),
          resourceType: z.string().optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async (): Promise<{ items: WorkspaceAuditLogItem[]; nextCursor: string | null }> => ({
      items: [],
      nextCursor: null,
    })),
});
