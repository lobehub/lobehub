/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { z } from 'zod';

import { SearchMode } from '../search';
import { LocalSystemConfig } from './agentConfig';

export interface WorkingModel {
  model: string;
  provider: string;
}

export interface LobeAgentChatConfig {
  /**
   * Local System configuration (desktop only)
   */
  localSystem?: LocalSystemConfig;
  enableAutoCreateTopic?: boolean;
  autoCreateTopicThreshold: number;

  enableMaxTokens?: boolean;

  /**
   * Whether to enable streaming output
   */
  enableStreaming?: boolean;

  /**
   * Whether to enable reasoning
   */
  enableReasoning?: boolean;
  /**
   * Whether to enable adaptive thinking (Claude Opus 4.6)
   */
  enableAdaptiveThinking?: boolean;
  /**
   * Custom reasoning effort level
   */
  enableReasoningEffort?: boolean;
  effort?: 'low' | 'medium' | 'high' | 'max';
  reasoningBudgetToken?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  gpt5ReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  gpt5_1ReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  gpt5_2ReasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  gpt5_2ProReasoningEffort?: 'medium' | 'high' | 'xhigh';
  /**
   * Output text verbosity control
   */
  textVerbosity?: 'low' | 'medium' | 'high';
  thinking?: 'disabled' | 'auto' | 'enabled';
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  thinkingBudget?: number;
  /**
   * Image aspect ratio for image generation models
   */
  imageAspectRatio?: string;
  /**
   * Image resolution for image generation models
   */
  imageResolution?: '1K' | '2K' | '4K';
  /**
   * Disable context caching
   */
  disableContextCaching?: boolean;
  /**
   * Number of historical messages
   */
  historyCount?: number;
  /**
   * Enable historical message count
   */
  enableHistoryCount?: boolean;
  /**
   * Enable history message compression threshold
   * @deprecated Use enableContextCompression instead
   */
  enableCompressHistory?: boolean;

  /**
   * Enable context compression
   * When enabled, old messages will be compressed into summaries when token threshold is reached
   */
  enableContextCompression?: boolean;
  /**
   * Model ID to use for generating compression summaries
   */
  compressionModelId?: string;

  inputTemplate?: string;

  searchMode?: SearchMode;
  searchFCModel?: WorkingModel;
  urlContext?: boolean;
  useModelBuiltinSearch?: boolean;

  /**
   * Maximum length for tool execution result content (in characters)
   * This prevents context overflow when sending tool results back to LLM
   * @default 6000
   */
  toolResultMaxLength?: number;

  /**
   * Whether to auto-scroll during AI streaming output
   * undefined = use global setting
   */
  enableAutoScrollOnStreaming?: boolean;
}
/* eslint-enable */

/**
 * Zod schema for LocalSystemConfig
 */
export const LocalSystemConfigSchema = z.object({
  workingDirectory: z.string().optional(),
});

export const AgentChatConfigSchema = z.object({
  autoCreateTopicThreshold: z.number().default(2),
  compressionModelId: z.string().optional(),
  disableContextCaching: z.boolean().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  enableAdaptiveThinking: z.boolean().optional(),
  enableAutoCreateTopic: z.boolean().optional(),
  enableAutoScrollOnStreaming: z.boolean().optional(),
  enableCompressHistory: z.boolean().optional(),
  enableContextCompression: z.boolean().optional(),
  enableHistoryCount: z.boolean().optional(),
  enableMaxTokens: z.boolean().optional(),
  enableReasoning: z.boolean().optional(),
  enableReasoningEffort: z.boolean().optional(),
  enableStreaming: z.boolean().optional(),
  gpt5ReasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  gpt5_1ReasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  gpt5_2ProReasoningEffort: z.enum(['medium', 'high', 'xhigh']).optional(),
  gpt5_2ReasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh']).optional(),
  historyCount: z.number().optional(),
  imageAspectRatio: z.string().optional(),
  imageResolution: z.enum(['1K', '2K', '4K']).optional(),
  localSystem: LocalSystemConfigSchema.optional(),
  reasoningBudgetToken: z.number().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  searchFCModel: z
    .object({
      model: z.string(),
      provider: z.string(),
    })
    .optional(),
  searchMode: z.enum(['off', 'on', 'auto']).optional(),
  textVerbosity: z.enum(['low', 'medium', 'high']).optional(),
  thinking: z.enum(['disabled', 'auto', 'enabled']).optional(),
  thinkingBudget: z.number().optional(),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  toolResultMaxLength: z.number().default(6000),
  urlContext: z.boolean().optional(),
  useModelBuiltinSearch: z.boolean().optional(),
});
