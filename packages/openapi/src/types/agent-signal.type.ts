import { AGENT_SIGNAL_CLIENT_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { z } from 'zod';

import { AGENT_SIGNAL_TRIGGER_SOURCE_TYPES } from '@/server/services/agentSignal/triggerSourceEvent';

/** Source event types the client is allowed to emit directly. */
export const AgentSignalClientSourceSchema = z.enum(AGENT_SIGNAL_CLIENT_SOURCE_TYPES);
/** Source event types the server can synthesise a trigger for. */
export const AgentSignalTriggerSourceSchema = z.enum(AGENT_SIGNAL_TRIGGER_SOURCE_TYPES);

export const AgentSignalReceiptIdParamSchema = z.object({
  id: z.string().min(1),
});

export const EmitSourceEventRequestSchema = z.object({
  /** Event body; `agentId` inside it overrides the routing agent. */
  payload: z.record(z.string(), z.unknown()),
  scopeKey: z.string().optional(),
  sourceId: z.string().min(1),
  sourceType: AgentSignalClientSourceSchema,
  timestamp: z.number().optional(),
});
export type EmitSourceEventRequest = z.infer<typeof EmitSourceEventRequestSchema>;

export const TriggerSourceEventRequestSchema = z.object({
  agentId: z.string().optional(),
  payloadOverride: z.record(z.string(), z.unknown()).optional(),
  scopeKey: z.string().optional(),
  sourceId: z.string().optional(),
  sourceType: AgentSignalTriggerSourceSchema,
  timestamp: z.number().optional(),
  topicId: z.string().optional(),
});
export type TriggerSourceEventRequest = z.infer<typeof TriggerSourceEventRequestSchema>;

export const ListReceiptsQuerySchema = z.object({
  agentId: z.string().min(1),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  sinceCreatedAt: z.coerce.number().int().min(0).optional(),
  topicId: z.string().min(1),
});
export type ListReceiptsQuery = z.infer<typeof ListReceiptsQuerySchema>;

export const RollbackReceiptRequestSchema = z.object({
  agentDocumentId: z.string().min(1).optional(),
  documentId: z.string().min(1),
  historyId: z.string().min(1),
  receiptId: z.string().min(1),
});
export type RollbackReceiptRequest = z.infer<typeof RollbackReceiptRequestSchema>;
