import debug from 'debug';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import {
  AGENT_SIGNAL_CLIENT_SOURCE_TYPES,
  type AgentSignalSourcePayloadMap,
} from '@/server/services/agentSignal/sourceTypes';

const log = debug('lobe-server:agent-signal:router');

const agentSignalProcedure = authedProcedure;
const clientSourceTypes = AGENT_SIGNAL_CLIENT_SOURCE_TYPES;

type ClientSourceType = (typeof clientSourceTypes)[number];
type ClientSourceEventInput = {
  [TSourceType in ClientSourceType]: {
    payload: AgentSignalSourcePayloadMap[TSourceType];
    scopeKey?: string;
    sourceId: string;
    sourceType: TSourceType;
    timestamp?: number;
  };
}[ClientSourceType];

export const agentSignalRouter = router({
  emitSourceEvent: agentSignalProcedure
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
      });
    }),
});
