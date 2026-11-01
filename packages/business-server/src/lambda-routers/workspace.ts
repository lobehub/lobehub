import {
  isWorkspaceSlugFormatValid,
  WORKSPACE_SLUG_MAX,
  WORKSPACE_SLUG_MIN,
} from '@lobechat/const';
import type { WorkspaceItem } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  wsAdminProcedure,
  wsCompatProcedure,
  wsProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { authedProcedure, router } from '@/libs/trpc/lambda';

/**
 * A workspace row as the workspace picker sees it: the stored record plus the
 * caller's membership role and the plan tag cloud derives from subscriptions.
 */
export interface WorkspaceMembershipSummary extends WorkspaceItem {
  lockedOut?: boolean;
  plan?: string;
  role: string | null;
}

export interface WorkspaceStatistics {
  agents: number;
  messages: number;
  messagesToday: number;
  topics: number;
}

// Same shape cloud enforces, so a slug the CLI or UI gets past this stub is
// only ever rejected for the reservations cloud adds on top.
const workspaceSlugSchema = z
  .string()
  .min(WORKSPACE_SLUG_MIN)
  .max(WORKSPACE_SLUG_MAX)
  .refine(isWorkspaceSlugFormatValid, { message: 'invalid-slug' });

const workspaceStatisticsInput = z
  .object({ todayStartAt: z.string().datetime().optional() })
  .optional();

const cloudOnly = (feature: string): never => {
  throw new TRPCError({
    code: 'NOT_IMPLEMENTED',
    message: `${feature} is a cloud-only feature.`,
  });
};

// Cloud overrides this at the same path with the real workspaceRouter backed by cloudDB.
// Only the procedures consumed by submodule (open-source) UI and by the CLI are declared
// here as typed no-op stubs so the contract type-checks; cloud supplies the real
// implementations. Keep the procedure builders and input schemas aligned with
// `apps/server/src/routers/lambda/workspace.ts` in the cloud repo — the point of a stub
// is to represent that contract, so a looser gate here is a real runtime difference.
export const workspaceRouter = router({
  checkSlugAvailable: authedProcedure
    .input(z.object({ slug: z.string().min(WORKSPACE_SLUG_MIN).max(WORKSPACE_SLUG_MAX) }))
    .query((): { available: boolean } => ({ available: false })),

  create: authedProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().max(1000).optional(),
        name: z.string().min(1).max(255),
        slug: workspaceSlugSchema,
      }),
    )
    .mutation(async (): Promise<WorkspaceItem> => cloudOnly('Workspace creation')),

  ensureMarketOrganization: authedProcedure
    .input(z.object({ autoProvision: z.boolean().optional() }).optional())
    .mutation(async (): Promise<{ created: boolean; marketAccountId: number }> => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Workspace market organization is a cloud-only feature.',
      });
    }),

  // `wsCompatProcedure` here, unlike cloud's `wsProcedure`, because open-source
  // callers (`buildAppUrl`) reach for it before they know whether a workspace
  // is in scope.
  getById: wsCompatProcedure.query((): WorkspaceItem | null => null),

  getMyStatistics: wsProcedure
    .input(workspaceStatisticsInput)
    .query((): WorkspaceStatistics | null => null),

  getSettings: wsProcedure.query((): Record<string, unknown> => ({})),

  /** Workspace-wide totals across all members — Admin or higher, like cloud. */
  getStatistics: wsAdminProcedure
    .input(workspaceStatisticsInput)
    .query((): WorkspaceStatistics | null => null),

  list: authedProcedure.query(async (): Promise<WorkspaceMembershipSummary[]> => []),

  update: wsAdminProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().max(1000).optional(),
        name: z.string().min(1).max(255).optional(),
        slug: workspaceSlugSchema.optional(),
      }),
    )
    .mutation(async (): Promise<void> => cloudOnly('Workspace update')),
});
