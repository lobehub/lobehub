import type { InboundWebhookItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { inboundWebhookItems } from '@/server/services/inboundWebhook/items';
import { getInboundWebhookKind } from '@/server/services/inboundWebhook/kinds';
import { removeInboundWebhook } from '@/server/services/inboundWebhook/lifecycle';
import { scheduleInboundWebhookSweep } from '@/server/services/inboundWebhook/sweep';
import { redisService } from '@/server/services/redis';

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

export const inboundWebhookRouter = router({
  check: writeProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }): Promise<InboundWebhookItem> => {
      const row = await ctx.webhookModel.findById(input.id);
      if (!row || row.status === 'pending' || row.status === 'deleting')
        throw new TRPCError({ code: 'NOT_FOUND' });
      assertWorkspaceRowManageable(ctx, row.userId, 'webhook', { allowAdmin: true });
      const kind = getInboundWebhookKind(row.kind);
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
      await kind.maintain({ db: ctx.serverDB, model, row });
      const updated = await model.findById(row.id);
      if (!updated || updated.status === 'deleting') throw new TRPCError({ code: 'NOT_FOUND' });
      return (await inboundWebhookItems(ctx.serverDB, [updated], ctx))[0];
    }),
  delete: writeProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }): Promise<{ success: true }> => {
      const row = await ctx.webhookModel.findById(input.id);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      assertWorkspaceRowManageable(ctx, row.userId, 'webhook', { allowAdmin: true });
      await removeInboundWebhook(ctx.serverDB, row);
      if (ctx.workspaceId)
        await new WorkspaceAuditLogModel(ctx.serverDB).create({
          action: 'webhook.deleted',
          ipAddress: ctx.clientIp ?? undefined,
          metadata: { direction: 'inbound', kind: row.kind },
          resourceId: row.id,
          resourceType: 'webhook',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      return { success: true };
    }),
  list: procedure.query(async ({ ctx }): Promise<InboundWebhookItem[]> =>
    inboundWebhookItems(ctx.serverDB, await ctx.webhookModel.query(), ctx),
  ),
});
