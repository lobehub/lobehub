import type { WorkspaceInvitationItem, WorkspaceMemberItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  wsAdminProcedure,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';

/** A membership row joined with the public profile of the member. */
export interface WorkspaceMemberSummary extends WorkspaceMemberItem {
  user: {
    avatar: string | null;
    email: string | null;
    fullName: string | null;
    username: string | null;
  } | null;
}

// Cloud overrides this at the same path with the real workspaceMemberRouter.
// Only the procedures consumed by submodule (open-source) UI and by the CLI are
// declared here as typed no-op stubs so the contract type-checks.
export const workspaceMemberRouter = router({
  invite: wsAdminProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        role: z.enum(['admin', 'member', 'viewer']).default('member'),
      }),
    )
    .mutation(async (): Promise<WorkspaceInvitationItem> => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Workspace invitations are a cloud-only feature.',
      });
    }),

  list: wsCompatProcedure
    .input(z.object({ includeDeleted: z.boolean().optional() }).optional())
    .query(async (): Promise<WorkspaceMemberSummary[]> => []),

  listInvitations: wsAdminProcedure.query(async (): Promise<WorkspaceInvitationItem[]> => []),
});
