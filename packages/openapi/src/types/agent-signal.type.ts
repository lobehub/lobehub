import { AGENT_SIGNAL_CLIENT_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { LayersEnum } from '@lobechat/types';
import { z } from 'zod';

import type { QueuedAgentSignalEmissionResult } from '@/server/services/agentSignal/enqueue';
import type {
  AgentSignalReceipt,
  AgentSignalReceiptListResult,
  AgentSignalReceiptMetadata,
} from '@/server/services/agentSignal/services/receiptService';
import type {
  EvidenceRef,
  Idea,
  IterationTarget,
  SelfFeedbackIntent,
} from '@/server/services/agentSignal/services/selfIteration/types';
import { AGENT_SIGNAL_TRIGGER_SOURCE_TYPES } from '@/server/services/agentSignal/triggerSourceEvent';

import { dateTimeSchema } from './common.type';

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

// ==================== Response Schemas ====================

/**
 * What an emission answers with. `accepted: false` (with an empty
 * `workflowRunId`) means Agent Signal is turned off for the caller, so the
 * event was dropped rather than queued.
 */
export const AgentSignalEmissionSchema = z
  .object({
    accepted: z.boolean(),
    /** The normalized scope the event was (or would have been) routed under. */
    scopeKey: z.string(),
    /** The workflow run processing the event; empty when not accepted. */
    workflowRunId: z.string(),
  } satisfies Record<keyof QueuedAgentSignalEmissionResult, z.ZodType>)
  .strict()
  .meta({ id: 'AgentSignalEmission' });

const EvidenceRefSchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    type: z.enum([
      'topic',
      'message',
      'operation',
      'source',
      'receipt',
      'tool_call',
      'task',
      'agent_document',
      'memory',
    ]),
  } satisfies Record<keyof EvidenceRef, z.ZodType>)
  .strict();

const IterationTargetSchema = z
  .object({
    memoryId: z.string().optional(),
    readonly: z.boolean().optional(),
    skillDocumentId: z.string().optional(),
    skillName: z.string().optional(),
    taskIds: z.array(z.string()).optional(),
    topicIds: z.array(z.string()).optional(),
  } satisfies Record<keyof IterationTarget, z.ZodType>)
  .strict();

const ideaShape = {
  evidenceRefs: z.array(EvidenceRefSchema),
  idempotencyKey: z.string(),
  rationale: z.string(),
  risk: z.enum(['high', 'low', 'medium']),
  target: IterationTargetSchema.optional(),
  title: z.string().optional(),
} satisfies Record<keyof Idea, z.ZodType>;

const SelfFeedbackIntentSchema = z
  .object({
    ...ideaShape,
    actionType: z.string().optional(),
    confidence: z.number(),
    downgradeReason: z
      .enum(['approval_required', 'low_confidence', 'unsupported_in_reflection'])
      .optional(),
    intentType: z.enum(['memory', 'skill', 'tooling', 'workflow']),
    mode: z.literal('reflection'),
    operation: z
      .discriminatedUnion('operation', [
        z
          .object({
            domain: z.literal('memory'),
            input: z.object({ content: z.string(), userId: z.string() }).strict(),
            operation: z.literal('write'),
          })
          .strict(),
        z
          .object({
            domain: z.literal('skill'),
            input: z
              .object({
                bodyMarkdown: z.string().optional(),
                description: z.string().optional(),
                name: z.string().optional(),
                title: z.string().optional(),
                userId: z.string(),
              })
              .strict(),
            operation: z.literal('create'),
          })
          .strict(),
        z
          .object({
            domain: z.literal('skill'),
            input: z
              .object({
                bodyMarkdown: z.string(),
                description: z.string().optional(),
                skillDocumentId: z.string(),
                userId: z.string(),
              })
              .strict(),
            operation: z.literal('refine'),
          })
          .strict(),
        z
          .object({
            domain: z.literal('skill'),
            input: z
              .object({
                bodyMarkdown: z.string().optional(),
                canonicalSkillDocumentId: z.string(),
                description: z.string().optional(),
                sourceSkillIds: z.array(z.string()),
                userId: z.string(),
              })
              .strict(),
            operation: z.literal('consolidate'),
          })
          .strict(),
      ])
      .optional(),
    urgency: z.enum(['immediate', 'later', 'soon']),
  } satisfies Record<keyof SelfFeedbackIntent, z.ZodType>)
  .strict();

const AgentSignalReceiptMetadataSchema = z
  .object({
    actionCount: z.number().int().optional(),
    actionStatus: z.enum(['applied', 'deduped', 'failed', 'proposed', 'skipped']).optional(),
    actionType: z
      .enum([
        'write_memory',
        'create_skill',
        'refine_skill',
        'refine_prompt',
        'consolidate_skill',
        'noop',
        'proposal_only',
      ])
      .optional(),
    agentDocumentId: z.string().optional(),
    documentId: z.string().optional(),
    evidenceRefs: z.array(EvidenceRefSchema).optional(),
    expectedCurrentDocumentUpdatedAt: dateTimeSchema.optional(),
    historyId: z.string().optional(),
    localDate: z.string().optional(),
    reviewScope: z.enum(['nightly', 'self_feedback', 'self_reflection']).optional(),
    rollbackStatus: z
      .enum(['available', 'conflict', 'failed', 'not_found', 'rolled_back', 'unsupported'])
      .optional(),
    scopeId: z.string().optional(),
    scopeType: z.string().optional(),
    selfIteration: z
      .object({
        ideas: z.array(z.object(ideaShape).strict()).optional(),
        intents: z.array(SelfFeedbackIntentSchema).optional(),
        mode: z.enum(['feedback', 'reflection', 'review']),
        reason: z.string().optional(),
        scope: z.object({ id: z.string(), type: z.string() }).strict().optional(),
        sourceId: z.string(),
        toolCallId: z.string().optional(),
        window: z.object({ end: dateTimeSchema, start: dateTimeSchema }).strict().optional(),
      } satisfies Record<keyof NonNullable<AgentSignalReceiptMetadata['selfIteration']>, z.ZodType>)
      .strict()
      .optional(),
    sourceType: z.string().optional(),
    timezone: z.string().optional(),
  } satisfies Record<keyof AgentSignalReceiptMetadata, z.ZodType>)
  .strict();

export const AgentSignalReceiptSchema = z
  .object({
    agentId: z.string(),
    /** Assistant message the receipt renders under, when known. */
    anchorMessageId: z.string().optional(),
    /** Epoch milliseconds. */
    createdAt: z.number(),
    /** Fallback detail copy for clients without locale keys. */
    detail: z.string(),
    id: z.string(),
    kind: z.enum(['memory', 'review', 'skill']),
    metadata: AgentSignalReceiptMetadataSchema.optional(),
    operationId: z.string().optional(),
    sourceId: z.string(),
    sourceType: z.string(),
    status: z.enum(['applied', 'completed', 'failed', 'proposed', 'skipped', 'updated']),
    /** Snapshot of the resource the receipt affected when it was produced. */
    target: z
      .object({
        agentDocumentId: z.string().optional(),
        documentId: z.string().optional(),
        id: z.string().optional(),
        memoryId: z.string().optional(),
        memoryLayer: z.enum(LayersEnum).optional(),
        operation: z.enum(['create', 'remove', 'update']).optional(),
        summary: z.string().optional(),
        title: z.string().optional(),
        type: z.enum(['memory', 'skill']),
      } satisfies Record<keyof NonNullable<AgentSignalReceipt['target']>, z.ZodType>)
      .strict()
      .optional(),
    /** Fallback title copy for clients without locale keys. */
    title: z.string(),
    topicId: z.string(),
    triggerMessageId: z.string().optional(),
    userId: z.string(),
  } satisfies Record<keyof AgentSignalReceipt, z.ZodType>)
  .strict()
  .meta({ id: 'AgentSignalReceipt' });

/** One newest-first page of receipts. */
export const AgentSignalReceiptListSchema = z
  .object({
    /** Offset to pass as `cursor` for the next page; absent on the last page. */
    cursor: z.number().int().optional(),
    receipts: z.array(AgentSignalReceiptSchema),
  } satisfies Record<keyof AgentSignalReceiptListResult, z.ZodType>)
  .strict()
  .meta({ id: 'AgentSignalReceiptList' });
