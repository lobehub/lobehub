import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';

/**
 * The fields of a published artifact site the open-source contract relies on.
 * Cloud returns a superset (`MarketDeploymentItem`).
 */
export interface MarketDeploymentSummary {
  artifactIdentifier: string | null;
  id: string;
  messageId: string | null;
  publicUrl: string;
  status: 'active' | 'unpublished' | 'building' | 'failed';
  title: string | null;
  topicId: string | null;
  updatedAt: Date;
}

const idSchema = z.object({ id: z.string().min(1) });

const cloudOnly = (): never => {
  throw new TRPCError({
    code: 'NOT_IMPLEMENTED',
    message: 'Artifact publishing is a cloud-only feature.',
  });
};

// Cloud overrides this at the same path with the real marketDeploymentsRouter.
// Only the procedures the open-source REST API calls are declared here, as
// typed stubs; keep their inputs aligned with cloud.
export const marketDeploymentsRouter = router({
  getById: wsCompatProcedure
    .input(idSchema)
    .query(async (): Promise<{ data: MarketDeploymentSummary; success: boolean }> => cloudOnly()),

  publishArtifact: wsCompatProcedure
    .input(
      z.object({
        artifactIdentifier: z.string().min(1),
        messageId: z.string().min(1),
        requestedSlug: z.string().optional(),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async (): Promise<{ data: MarketDeploymentSummary; success: boolean }> =>
      cloudOnly(),
    ),

  unpublish: wsCompatProcedure
    .input(idSchema)
    .mutation(async (): Promise<{ data: MarketDeploymentSummary; success: boolean }> =>
      cloudOnly(),
    ),
});
