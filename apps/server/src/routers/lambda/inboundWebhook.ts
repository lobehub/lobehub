import type {
  InboundWebhookDeliveryPage,
  InboundWebhookItem,
  InboundWebhookItemWithSecret,
} from '@lobechat/types';
import { GENERIC_WEBHOOK_TOPIC_MODES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import type { InboundWebhookView as InboundWebhookRowView } from '@/database/models/inboundWebhook';
import { InboundWebhookLimitError, InboundWebhookModel } from '@/database/models/inboundWebhook';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { listInboundWebhookDeliveries } from '@/server/services/inboundWebhook/deliveries';
import { isWebhookEnabled } from '@/server/services/inboundWebhook/featureGate';
import {
  canConfigureInboundWebhook,
  canManageInboundWebhook,
  inboundWebhookItems,
} from '@/server/services/inboundWebhook/items';
import { getInboundWebhookKind } from '@/server/services/inboundWebhook/kinds';
import {
  asGeneric,
  createGenericWebhook,
  GenericWebhookError,
  rotateGenericWebhookToken,
  sendGenericWebhookTest,
  updateGenericWebhook,
} from '@/server/services/inboundWebhook/kinds/generic/service';
import { removeInboundWebhook } from '@/server/services/inboundWebhook/lifecycle';
import { scheduleInboundWebhookSweep } from '@/server/services/inboundWebhook/sweep';
import { redisService } from '@/server/services/redis';
import { assertCanEditResource } from '@/server/services/resourcePermission';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

const procedure = wsCompatProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  scheduleInboundWebhookSweep();
  return next({
    ctx: {
      webhookModel: new InboundWebhookModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
    },
  });
});
const writeProcedure = procedure.use(requireWorkspaceRoleWhenScoped('member'));
const idInput = z.object({ id: z.string().uuid() });

const genericSettings = {
  autoApprove: z.boolean().optional(),
  instructions: z.string().max(4000).nullable().optional(),
  name: z.string().max(100).nullable().optional(),
  topicId: z.string().min(1).nullable().optional(),
  topicMode: z.enum(GENERIC_WEBHOOK_TOPIC_MODES).optional(),
};

interface RouterScope {
  clientIp?: string | null;
  serverDB: LobeChatDatabase;
  userId: string;
  webhookModel: InboundWebhookModel;
  workspaceId?: string | null;
  workspaceRole?: string;
}

const items = (ctx: RouterScope, rows: InboundWebhookRowView[]) =>
  inboundWebhookItems(ctx.serverDB, rows, ctx);

const audit = async (
  ctx: RouterScope,
  action: 'webhook.created' | 'webhook.updated' | 'webhook.deleted',
  row: InboundWebhookRowView,
  metadata: Record<string, unknown> = {},
) => {
  if (!ctx.workspaceId) return;
  await new WorkspaceAuditLogModel(ctx.serverDB).create({
    action,
    ipAddress: ctx.clientIp ?? undefined,
    metadata: { direction: 'inbound', kind: row.kind, ...metadata },
    resourceId: row.id,
    resourceType: 'webhook',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

/** Changing a generic webhook needs the feature on, and the row managed by the caller. */
const manageableGeneric = async (ctx: RouterScope, id: string) => {
  if (!(await isWebhookEnabled(ctx.userId))) throw new TRPCError({ code: 'NOT_FOUND' });
  const row = await ctx.webhookModel.findById(id);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  assertWorkspaceRowManageable(ctx, row.userId, 'webhook', { allowAdmin: true });
  try {
    return asGeneric(row);
  } catch (error) {
    throw toTRPCError(error);
  }
};

/**
 * Managing a webhook row (pause, delete) is the workspace's business, but what the webhook runs
 * acts on its agent. Its task, its URL, a test run and what callers sent need that agent: `use`
 * to see it, `edit` to change or run it, the same gate as creating the webhook. A workspace admin
 * may stop a colleague's private-agent webhook without being able to drive that agent.
 */
const assertAgentAccess = async (
  ctx: RouterScope,
  row: InboundWebhookRowView,
  level: 'edit' | 'use',
) => {
  const scope = { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined };
  await assertAgentUsableBy(ctx.serverDB, row.agentId, scope);
  if (level === 'edit')
    await assertCanEditResource({
      db: ctx.serverDB,
      resourceId: row.agentId,
      resourceType: 'agent',
      ...scope,
    });
};

/**
 * A webhook runs as its creator, under their approval settings. Only they may change what it runs,
 * test it or get its URL: anyone else doing so would drive the agent as them. Admins still pause,
 * resume and delete it.
 */
const assertConfigures = (ctx: RouterScope, row: InboundWebhookRowView) => {
  if (!canConfigureInboundWebhook(ctx, row))
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the member who created this webhook can change what it runs.',
    });
};

const toTRPCError = (error: unknown) => {
  if (error instanceof GenericWebhookError)
    return new TRPCError({
      code: error.code === 'not_found' ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: error.message,
    });
  if (error instanceof InboundWebhookLimitError)
    return new TRPCError({ code: 'TOO_MANY_REQUESTS', message: error.message });
  return error;
};

export const inboundWebhookRouter = router({
  check: writeProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }): Promise<InboundWebhookItem> => {
      const row = await ctx.webhookModel.findById(input.id);
      if (!row || row.status === 'pending' || row.status === 'deleting')
        throw new TRPCError({ code: 'NOT_FOUND' });
      assertWorkspaceRowManageable(ctx, row.userId, 'webhook', { allowAdmin: true });
      const kind = getInboundWebhookKind(row.kind);
      if (kind?.maintain && !(await kind.isEnabled(row.userId)))
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'MCP Events is disabled for this subscription owner.',
        });
      if (!kind?.maintain)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This automation does not support checking.',
        });
      if (!(await redisService.inboundWebhook.claimCheck(row.id)))
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Wait 30 seconds before checking again.',
        });
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      // A workspace admin may maintain a colleague's endpoint using its creator's credentials.
      const model = new InboundWebhookModel(
        ctx.serverDB,
        row.userId,
        row.workspaceId ?? undefined,
        gateKeeper,
      );
      await kind.maintain({ db: ctx.serverDB, featureEnabled: true, model, row });
      const updated = await model.findById(row.id);
      if (!updated || updated.status === 'deleting') throw new TRPCError({ code: 'NOT_FOUND' });
      return (await items(ctx, [updated]))[0];
    }),
  /** A generic webhook for an agent the caller may edit, with its key: the only time it is shown. */
  create: writeProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string().min(1), ...genericSettings }))
    .mutation(async ({ ctx, input }): Promise<InboundWebhookItemWithSecret> => {
      if (!(await isWebhookEnabled(ctx.userId))) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertAgentUsableBy(ctx.serverDB, input.agentId, {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.agentId,
        resourceType: 'agent',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      try {
        const { row, secret } = await createGenericWebhook(
          ctx.serverDB,
          { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
          input,
        );
        await audit(ctx, 'webhook.created', row, { autoApprove: row.config.autoApprove });
        return { item: (await items(ctx, [row]))[0], secret };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  delete: writeProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }): Promise<{ success: true }> => {
      const row = await ctx.webhookModel.findById(input.id);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      assertWorkspaceRowManageable(ctx, row.userId, 'webhook', { allowAdmin: true });
      await removeInboundWebhook(ctx.serverDB, row);
      await audit(ctx, 'webhook.deleted', row);
      return { success: true };
    }),
  /** A webhook's deliveries, newest first; only its managers see what callers sent. */
  listDeliveries: procedure
    .input(
      z.object({
        cursor: z.object({ createdAt: z.string().datetime(), id: z.string().uuid() }).optional(),
        id: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }): Promise<InboundWebhookDeliveryPage> => {
      const row = await ctx.webhookModel.findById(input.id);
      if (!row || !canManageInboundWebhook(ctx, row)) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertAgentAccess(ctx, row, 'use');
      return listInboundWebhookDeliveries(ctx.serverDB, row, input.cursor);
    }),
  list: procedure
    .input(z.object({ agentId: z.string().min(1).optional() }).optional())
    .query(async ({ ctx, input }): Promise<InboundWebhookItem[]> =>
      items(ctx, await ctx.webhookModel.query({ agentId: input?.agentId })),
    ),
  /** Issue a new key, shown this once; the old key stops working at once and the URL stays. */
  rotateToken: writeProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }): Promise<InboundWebhookItemWithSecret> => {
      const row = await manageableGeneric(ctx, input.id);
      await assertAgentAccess(ctx, row, 'edit');
      assertConfigures(ctx, row);
      try {
        const rotated = await rotateGenericWebhookToken(ctx.serverDB, row);
        await audit(ctx, 'webhook.updated', rotated.row, { rotatedToken: true });
        return { item: (await items(ctx, [rotated.row]))[0], secret: rotated.secret };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  /** Run a sample request through the real receiver, so the Agent wakes as it would for a caller. */
  sendTest: writeProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const row = await manageableGeneric(ctx, input.id);
    await assertAgentAccess(ctx, row, 'edit');
    assertConfigures(ctx, row);
    try {
      return await sendGenericWebhookTest(ctx.serverDB, row);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  update: writeProcedure
    .input(z.object({ id: z.string().uuid(), paused: z.boolean().optional(), ...genericSettings }))
    .mutation(async ({ ctx, input }): Promise<InboundWebhookItem> => {
      const row = await manageableGeneric(ctx, input.id);
      const { id: _id, paused, ...settings } = input;
      // Pausing or resuming alone stays an administrative action.
      if (Object.values(settings).some((value) => value !== undefined)) {
        // An agent the caller cannot see stays not-found rather than forbidden.
        await assertAgentAccess(ctx, row, 'edit');
        assertConfigures(ctx, row);
      }
      const changes = { ...settings, paused };
      try {
        const updated = await updateGenericWebhook(ctx.serverDB, row, changes);
        await audit(ctx, 'webhook.updated', updated, {
          ...(input.autoApprove !== undefined && { autoApprove: input.autoApprove }),
          ...(input.paused !== undefined && { paused: input.paused }),
        });
        return (await items(ctx, [updated]))[0];
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
