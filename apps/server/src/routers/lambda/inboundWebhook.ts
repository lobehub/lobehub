import type {
  InboundWebhookDeliveryPage,
  InboundWebhookItem,
  InboundWebhookItemWithSecret,
} from '@lobechat/types';
import {
  GENERIC_WEBHOOK_TOPIC_MODES,
  INBOUND_WEBHOOK_KINDS,
  InboundWebhookChannelDeliverySchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  InboundWebhookManageError,
  InboundWebhookManager,
} from '@/server/services/inboundWebhook/manage';
import { scheduleInboundWebhookSweep } from '@/server/services/inboundWebhook/sweep';

const TRPC_CODES = {
  bad_request: 'BAD_REQUEST',
  disabled: 'NOT_FOUND',
  forbidden: 'FORBIDDEN',
  not_found: 'NOT_FOUND',
  rate_limited: 'TOO_MANY_REQUESTS',
} as const;

/** The manager owns every rule; the router only maps its errors to TRPC codes. */
const run = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof InboundWebhookManageError)
      throw new TRPCError({ code: TRPC_CODES[error.code], message: error.message });
    throw error;
  }
};

const procedure = wsCompatProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  scheduleInboundWebhookSweep();
  return next({
    ctx: {
      webhooks: new InboundWebhookManager(ctx.serverDB, {
        clientIp: ctx.clientIp,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        // Set by the cloud's workspace middleware; the open-source stub does not inject it.
        workspaceRole: (ctx as { workspaceRole?: string }).workspaceRole,
      }),
    },
  });
});
const writeProcedure = procedure.use(requireWorkspaceRoleWhenScoped('member'));
const idInput = z.object({ id: z.string().uuid() });

const genericSettings = {
  autoApprove: z.boolean().optional(),
  /** Post each run's answer to a Channel or Thread; null stops posting. Not offered on the Web. */
  delivery: InboundWebhookChannelDeliverySchema.nullable().optional(),
  instructions: z.string().max(4000).nullable().optional(),
  name: z.string().max(100).nullable().optional(),
  topicId: z.string().min(1).nullable().optional(),
  topicMode: z.enum(GENERIC_WEBHOOK_TOPIC_MODES).optional(),
};

export const inboundWebhookRouter = router({
  /** Check an MCP Events subscription with its server now. */
  check: writeProcedure
    .input(idInput)
    .mutation(({ ctx, input }): Promise<InboundWebhookItem> =>
      run(() => ctx.webhooks.check(input.id)),
    ),
  /** A custom webhook for an agent the caller may edit, with its key: the only time it is shown. */
  create: writeProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string().min(1), ...genericSettings }))
    .mutation(({ ctx, input }): Promise<InboundWebhookItemWithSecret> =>
      run(() => ctx.webhooks.create(input)),
    ),
  delete: writeProcedure
    .input(idInput)
    .mutation(({ ctx, input }): Promise<{ success: true }> =>
      run(() => ctx.webhooks.delete(input.id)),
    ),
  get: procedure
    .input(idInput)
    .query(({ ctx, input }): Promise<InboundWebhookItem> => run(() => ctx.webhooks.get(input.id))),
  /** A webhook's calls, newest first; only its managers see what callers sent. */
  listDeliveries: procedure
    .input(
      z.object({
        cursor: z.object({ createdAt: z.string().datetime(), id: z.string().uuid() }).optional(),
        id: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }): Promise<InboundWebhookDeliveryPage> =>
      run(() => ctx.webhooks.listDeliveries(input.id, input.cursor)),
    ),
  list: procedure
    .input(
      z
        .object({
          agentId: z.string().min(1).optional(),
          /** Custom webhooks and MCP Events subscriptions are listed apart. */
          kind: z.enum(INBOUND_WEBHOOK_KINDS).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }): Promise<InboundWebhookItem[]> =>
      run(() => ctx.webhooks.list({ agentId: input?.agentId, kind: input?.kind })),
    ),
  /** Issue a new key, shown this once; the old key stops working at once and the URL stays. */
  rotateToken: writeProcedure
    .input(idInput)
    .mutation(({ ctx, input }): Promise<InboundWebhookItemWithSecret> =>
      run(() => ctx.webhooks.rotateKey(input.id)),
    ),
  /** Run a sample request through the real receiver, so the Agent wakes as it would for a caller. */
  sendTest: writeProcedure
    .input(idInput)
    .mutation(({ ctx, input }) => run(() => ctx.webhooks.sendTest(input.id))),
  update: writeProcedure
    .input(z.object({ id: z.string().uuid(), paused: z.boolean().optional(), ...genericSettings }))
    .mutation(({ ctx, input }): Promise<InboundWebhookItem> => {
      const { id, ...changes } = input;
      return run(() => ctx.webhooks.update(id, changes));
    }),
});
