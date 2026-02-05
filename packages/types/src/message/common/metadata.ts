/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
import { z } from 'zod';

import type { PageSelection} from './pageSelection';
import { PageSelectionSchema } from './pageSelection';

export interface ModelTokensUsage {
  // Prediction tokens
  acceptedPredictionTokens?: number;
  inputAudioTokens?: number;
  // Input tokens breakdown
  /**
   * user prompt input
   */
  // Input cache tokens
  inputCachedTokens?: number;

  inputCacheMissTokens?: number;
  /**
   * currently only pplx has citation_tokens
   */
  inputCitationTokens?: number;
  /**
   * user prompt image
   */
  inputImageTokens?: number;
  inputTextTokens?: number;

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
  inputTextTokens: z.number().optional(),
  inputImageTokens: z.number().optional(),
  inputAudioTokens: z.number().optional(),
  inputCitationTokens: z.number().optional(),

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

export const MessageMetadataSchema = ModelUsageSchema.merge(ModelPerformanceSchema).extend({
  collapsed: z.boolean().optional(),
  inspectExpanded: z.boolean().optional(),
  isMultimodal: z.boolean().optional(),
  isSupervisor: z.boolean().optional(),
  pageSelections: z.array(PageSelectionSchema).optional(),
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

export interface MessageMetadata extends ModelUsage, ModelPerformance {
  activeBranchIndex?: number;
  activeColumn?: boolean;
  /**
   * Message collapse state
   * true: collapsed, false/undefined: expanded
   */
  collapsed?: boolean;
  compare?: boolean;
  finishType?: string;
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
  taskTitle?: string;
  // message content is multimodal, display content in the streaming, won't save to db
  tempDisplayContent?: string;
  usage?: ModelUsage;
}
