import {
  AGENT_HUMAN_REQUEST_STATUSES,
  AGENT_HUMAN_REQUEST_SURFACES,
  AGENT_HUMAN_REQUEST_TYPES,
} from '@lobechat/types';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createAgentHumanRequestService } from '@/server/services/agentHumanRequest/factory';

/**
 * Agent human requests — approval and secure-input cards an agent parked for
 * its owner. Same service as the REST surface (`/api/v1/human-requests`), so
 * web, desktop and the native apps answer a card through one lifecycle.
 *
 * Answering sends a message as the agent, so it takes the `message:create`
 * grant a chat turn takes. A `fulfill` input carries an ASC/1 HPKE envelope,
 * never the secret itself.
 */
const humanRequestProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: {
      humanRequestService: await createAgentHumanRequestService(
        opts.ctx.serverDB,
        opts.ctx.userId,
        { workspaceId: opts.ctx.workspaceId ?? undefined },
      ),
    },
  }),
);

const envelopeSchema = z
  .object({
    ct: z.string().min(1).max(8192),
    enc: z.string().min(1).max(64),
    requestId: z.string().min(1).max(64),
    sender: z.string().max(128).optional(),
    suite: z.string().min(1).max(128),
    v: z.number().int(),
  })
  .strict();

const decisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    edits: z
      .object({
        subject: z.string().max(998).optional(),
        text: z.string().min(1).max(20_000).optional(),
        to: z.string().min(1).max(320).optional(),
      })
      .strict()
      .optional(),
  }),
  z.object({ action: z.literal('decline') }),
  z.object({ action: z.literal('retry') }),
  z.object({ action: z.literal('fulfill'), envelope: envelopeSchema }),
]);

export const agentHumanRequestRouter = router({
  decide: humanRequestProcedure
    .use(withScopedPermission('message:create'))
    .input(
      z.object({
        decision: decisionSchema,
        id: z.string().min(1),
        via: z.enum(AGENT_HUMAN_REQUEST_SURFACES).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.humanRequestService.decide(input.id, input.decision, input.via ?? 'web'),
    ),

  get: humanRequestProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.humanRequestService.get(input.id)),

  identity: humanRequestProcedure.query(({ ctx }) => ctx.humanRequestService.identity()),

  list: humanRequestProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          status: z.array(z.enum(AGENT_HUMAN_REQUEST_STATUSES)).optional(),
          topicId: z.string().optional(),
          type: z.enum(AGENT_HUMAN_REQUEST_TYPES).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => ctx.humanRequestService.list(input ?? {})),
});
