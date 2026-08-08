import {
  AGENT_SIGNAL_CLIENT_SOURCE_TYPES,
  type AgentSignalSourceEventInput,
} from '@lobechat/agent-signal/source';
import debug from 'debug';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { rollbackAgentSignalReceipt } from '@/server/services/agentSignal/services/receiptRollbackService';
import { listAgentSignalReceipts } from '@/server/services/agentSignal/services/receiptService';
import {
  AGENT_SIGNAL_TRIGGER_SOURCE_TYPES,
  buildTriggerSourceEvent,
} from '@/server/services/agentSignal/triggerSourceEvent';

const log = debug('lobe-server:agent-signal:router');

const agentSignalProcedure = wsCompatProcedure;
const agentSignalWriteProcedure = agentSignalProcedure.use(withScopedPermission('message:create'));
const agentSignalAgentWriteProcedure = agentSignalProcedure.use(
  withScopedPermission('agent:update'),
);
const agentSignalAgentDatabaseWriteProcedure = agentSignalAgentWriteProcedure.use(serverDatabase);
const clientSourceTypes = AGENT_SIGNAL_CLIENT_SOURCE_TYPES;

type ClientSourceType = (typeof clientSourceTypes)[number];
type ClientSourceEventInput = AgentSignalSourceEventInput<ClientSourceType>;

export const agentSignalRouter = router({
  emitSourceEvent: agentSignalWriteProcedure
    .input(
      z.object({
        payload: z.record(z.string(), z.unknown()),
        scopeKey: z.string().optional(),
        sourceId: z.string(),
        sourceType: z.enum(clientSourceTypes),
        timestamp: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log('Received emitSourceEvent payload=%O', {
        agentId: typeof input.payload.agentId === 'string' ? input.payload.agentId : undefined,
        payload: input.payload,
        scopeKey: input.scopeKey,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        timestamp: input.timestamp,
        userId: ctx.userId,
      });

      return enqueueAgentSignalSourceEvent(input as unknown as ClientSourceEventInput, {
        agentId: typeof input.payload.agentId === 'string' ? input.payload.agentId : undefined,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
    }),
  triggerSourceEvent: agentSignalProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        payloadOverride: z.record(z.string(), z.unknown()).optional(),
        scopeKey: z.string().optional(),
        sourceId: z.string().optional(),
        sourceType: z.enum(AGENT_SIGNAL_TRIGGER_SOURCE_TYPES),
        timestamp: z.number().optional(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sourceEvent = buildTriggerSourceEvent({
        agentId: input.agentId,
        payloadOverride: input.payloadOverride,
        scopeKey: input.scopeKey,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        timestamp: input.timestamp,
        topicId: input.topicId,
        userId: ctx.userId,
      });

      log(
        'Triggering source event sourceType=%s sourceId=%s',
        sourceEvent.sourceType,
        sourceEvent.sourceId,
      );

      return enqueueAgentSignalSourceEvent(sourceEvent, {
        agentId: input.agentId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
    }),
  listReceipts: agentSignalProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        cursor: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        sinceCreatedAt: z.number().int().min(0).optional(),
        topicId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      return listAgentSignalReceipts({
        agentId: input.agentId,
        cursor: input.cursor,
        limit: input.limit,
        sinceCreatedAt: input.sinceCreatedAt,
        topicId: input.topicId,
        userId: ctx.userId,
      });
    }),
  rollbackReceipt: agentSignalAgentDatabaseWriteProcedure
    .input(
      z.object({
        agentDocumentId: z.string().min(1).optional(),
        documentId: z.string().min(1),
        historyId: z.string().min(1),
        receiptId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return rollbackAgentSignalReceipt(input, {
        db: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
    }),
});
