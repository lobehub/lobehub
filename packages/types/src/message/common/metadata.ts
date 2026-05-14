import { z } from 'zod';

import { RequestTrigger } from '../../agentRuntime';
import type { PageSelection } from './pageSelection';
import { PageSelectionSchema } from './pageSelection';

const LocalSystemToolSnapshotSchema = z.object({
  apiName: z.enum(['readFile', 'listFiles', 'readLocalFile', 'listLocalFiles']),
  arguments: z.record(z.string(), z.unknown()),
  capturedAt: z.string(),
  content: z.string().nullable(),
  error: z.unknown().optional(),
  identifier: z.literal('lobe-local-system'),
  result: z.unknown().optional(),
  snapshotId: z.string(),
  state: z.unknown().optional(),
  success: z.boolean(),
  toolCallId: z.string(),
});

export interface LocalSystemToolSnapshot {
  apiName: 'readFile' | 'listFiles' | 'readLocalFile' | 'listLocalFiles';
  arguments: Record<string, unknown>;
  capturedAt: string;
  content: string | null;
  error?: unknown;
  identifier: 'lobe-local-system';
  result?: unknown;
  snapshotId: string;
  state?: unknown;
  success: boolean;
  toolCallId: string;
}

export interface ModelTokensUsage {
  // Prediction tokens
  acceptedPredictionTokens?: number;
  /**
   * Total input audio tokens for the request. This is a modality breakdown, not
   * a cache-miss count.
   */
  inputAudioTokens?: number;
  /**
   * Cached audio tokens for the request.
   */
  inputCachedAudioTokens?: number;
  /**
   * Cached image tokens for the request.
   */
  inputCachedImageTokens?: number;
  /**
   * Cached text tokens for the request.
   */
  inputCachedTextTokens?: number;
  // Input tokens breakdown
  /**
   * user prompt input
   */
  // Input cache tokens
  inputCachedTokens?: number;
  /**
   * Cached video tokens for the request.
   */
  inputCachedVideoTokens?: number;

  inputCacheMissTokens?: number;
  /**
   * currently only pplx has citation_tokens
   */
  inputCitationTokens?: number;
  /**
   * Total user prompt image tokens for the request. This is a modality
   * breakdown, not a cache-miss count.
   */
  inputImageTokens?: number;
  /**
   * Total user prompt text tokens for the request. This is a modality
   * breakdown, not a cache-miss count.
   */
  inputTextTokens?: number;
  /**
   * tool use prompt tokens (Google AI / Vertex AI)
   */
  inputToolTokens?: number;

  /**
   * Total user prompt video tokens for the request. This is a modality
   * breakdown, not a cache-miss count.
   */
  inputVideoTokens?: number;
  inputWriteCacheTokens?: number;
  outputAudioTokens?: number;
  outputImageTokens?: number;
  outputReasoningTokens?: number;

  // Output tokens breakdown
  outputTextTokens?: number;
  rejectedPredictionTokens?: number;

  // Total tokens
  // TODO: make all following fields required
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
}

export const ModelUsageSchema = z.object({
  // Input tokens breakdown
  inputCachedTokens: z.number().optional(),
  inputCacheMissTokens: z.number().optional(),
  inputWriteCacheTokens: z.number().optional(),
  inputCachedTextTokens: z.number().optional(),
  inputCachedImageTokens: z.number().optional(),
  inputCachedAudioTokens: z.number().optional(),
  inputCachedVideoTokens: z.number().optional(),
  inputTextTokens: z.number().optional(),
  inputImageTokens: z.number().optional(),
  inputAudioTokens: z.number().optional(),
  inputVideoTokens: z.number().optional(),
  inputCitationTokens: z.number().optional(),
  inputToolTokens: z.number().optional(),

  // Output tokens breakdown
  outputTextTokens: z.number().optional(),
  outputImageTokens: z.number().optional(),
  outputAudioTokens: z.number().optional(),
  outputReasoningTokens: z.number().optional(),

  // Prediction tokens
  acceptedPredictionTokens: z.number().optional(),
  rejectedPredictionTokens: z.number().optional(),

  // Total tokens
  totalInputTokens: z.number().optional(),
  totalOutputTokens: z.number().optional(),
  totalTokens: z.number().optional(),

  // Cost
  cost: z.number().optional(),
});

export const ModelPerformanceSchema = z.object({
  tps: z.number().optional(),
  ttft: z.number().optional(),
  duration: z.number().optional(),
  latency: z.number().optional(),
});

// ============ Emoji Reaction ============ //

export interface EmojiReaction {
  count: number;
  emoji: string;
  users: string[];
}

export const EmojiReactionSchema = z.object({
  emoji: z.string(),
  count: z.number(),
  users: z.array(z.string()),
});

export const MessageMetadataSchema = ModelUsageSchema.merge(ModelPerformanceSchema).extend({
  collapsed: z.boolean().optional(),
  inspectExpanded: z.boolean().optional(),
  isMultimodal: z.boolean().optional(),
  isSupervisor: z.boolean().optional(),
  localSystemToolSnapshots: z.array(LocalSystemToolSnapshotSchema).optional(),
  pageSelections: z.array(PageSelectionSchema).optional(),
  // Canonical nested shape — flat fields above are deprecated. Must be listed
  // here so zod doesn't strip them from writes going through UpdateMessageParamsSchema
  // (e.g. messageService.updateMessage, used by the heterogeneous-agent executor).
  performance: ModelPerformanceSchema.optional(),
  reactions: z.array(EmojiReactionSchema).optional(),
  scope: z.string().optional(),
  subAgentId: z.string().optional(),
  toolExecutionTimeMs: z.number().optional(),
  trigger: z.nativeEnum(RequestTrigger).optional(),
  usage: ModelUsageSchema.optional(),
});

export interface ModelUsage extends ModelTokensUsage {
  /**
   * dollar
   */
  cost?: number;
}

export interface ModelPerformance {
  /**
   * from output start to output finish (ms)
   */
  duration?: number;
  /**
   * from input start to output finish (ms)
   */
  latency?: number;
  /**
   * tokens per second
   */
  tps?: number;
  /**
   * time to first token (ms)
   */
  ttft?: number;
}

export interface MessageMetadata {
  // ───────────────────────────────────────────────────────────────
  // Token usage + performance fields — DEPRECATED flat shape.
  // New code must write to `metadata.usage` / `metadata.performance` (nested)
  // instead. Kept here so legacy reads still type-check during migration;
  // writers should stop populating them.
  // ───────────────────────────────────────────────────────────────
  /** @deprecated use `metadata.usage` instead */
  acceptedPredictionTokens?: number;
  activeBranchIndex?: number;
  activeColumn?: boolean;
  /**
   * Message collapse state
   * true: collapsed, false/undefined: expanded
   */
  collapsed?: boolean;
  compare?: boolean;
  /** @deprecated use `metadata.usage` instead */
  cost?: number;
  /** @deprecated use `metadata.performance` instead */
  duration?: number;
  finishType?: string;
  /** @deprecated use `metadata.usage` instead */
  inputAudioTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputCachedAudioTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputCachedImageTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputCachedTextTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputCachedTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputCachedVideoTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputCacheMissTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputCitationTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputImageTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputTextTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputToolTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputVideoTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  inputWriteCacheTokens?: number;
  /**
   * Tool inspect expanded state
   * true: expanded, false/undefined: collapsed
   */
  inspectExpanded?: boolean;
  /**
   * Task instruction (for role='task' messages)
   * The instruction given by supervisor to the agent
   * Thread's sourceMessageId links back to this message for status tracking
   */
  instruction?: string;
  /**
   * Flag indicating if message content is multimodal (serialized MessageContentPart[])
   */
  isMultimodal?: boolean;

  /**
   * Flag indicating if message is from the Supervisor agent in group orchestration
   * Used by conversation-flow to transform role to 'supervisor' for UI rendering
   */
  isSupervisor?: boolean;
  /** @deprecated use `metadata.performance` instead */
  latency?: number;
  /**
   * Local-system tool snapshots materialized when the user sent @file mentions.
   */
  localSystemToolSnapshots?: LocalSystemToolSnapshot[];
  /** @deprecated use `metadata.usage` instead */
  outputAudioTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  outputImageTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  outputReasoningTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  outputTextTokens?: number;
  /**
   * Page selections attached to user message
   * Used for Ask AI functionality to persist selection context
   */
  pageSelections?: PageSelection[];
  performance?: ModelPerformance;
  /**
   * Flag indicating if message is pinned (excluded from compression)
   */
  pinned?: boolean;
  /**
   * Emoji reactions on this message
   */
  reactions?: EmojiReaction[];
  /** @deprecated use `metadata.usage` instead */
  rejectedPredictionTokens?: number;
  /**
   * Message scope - indicates the context in which this message was created
   * Used by conversation-flow to determine how to handle message grouping and display
   * See MessageMapScope for available values
   */
  scope?: string;
  /**
   * Sub Agent ID - behavior depends on scope
   * - scope: 'sub_agent': conversation-flow will transform message.agentId to this value for display
   * - scope: 'group' | 'group_agent': indicates the agent that generated this message in group mode
   * Used by callAgent tool (sub_agent) and group orchestration (group modes)
   */
  subAgentId?: string;
  taskTitle?: string;
  // message content is multimodal, display content in the streaming, won't save to db
  tempDisplayContent?: string;
  /**
   * Tool execution time for tool messages (ms)
   */
  toolExecutionTimeMs?: number;
  /** @deprecated use `metadata.usage` instead */
  totalInputTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  totalOutputTokens?: number;
  /** @deprecated use `metadata.usage` instead */
  totalTokens?: number;
  /** @deprecated use `metadata.performance` instead */
  tps?: number;
  /**
   * Request source used by runtime routing, billing, and logs.
   */
  trigger?: RequestTrigger;
  /** @deprecated use `metadata.performance` instead */
  ttft?: number;
  usage?: ModelUsage;
}
