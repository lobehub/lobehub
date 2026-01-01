/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { z } from 'zod';

import { SearchMode } from '../search';

export interface WorkingModel {
  model: string;
  provider: string;
}

export interface LobeAgentChatConfig {
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
   * Custom reasoning effort level
   */
  enableReasoningEffort?: boolean;
  reasoningBudgetToken?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  gpt5ReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  gpt5_1ReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  /**
   * Output text verbosity control
   */
  textVerbosity?: 'low' | 'medium' | 'high';
  thinking?: 'disabled' | 'auto' | 'enabled';
  thinkingLevel?: 'low' | 'high';
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
   */
  enableCompressHistory?: boolean;

  inputTemplate?: string;

  searchMode?: SearchMode;
  searchFCModel?: WorkingModel;
  urlContext?: boolean;
  useModelBuiltinSearch?: boolean;
}
/* eslint-enable */

export const AgentChatConfigSchema = z.object({
  autoCreateTopicThreshold: z.number().default(2),
  disableContextCaching: z.boolean().optional(),
  enableAutoCreateTopic: z.boolean().optional(),
  enableCompressHistory: z.boolean().optional(),
  enableHistoryCount: z.boolean().optional(),
  enableMaxTokens: z.boolean().optional(),
  enableReasoning: z.boolean().optional(),
  enableReasoningEffort: z.boolean().optional(),
  enableStreaming: z.boolean().optional(),
  gpt5ReasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  gpt5_1ReasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  historyCount: z.number().optional(),
  imageAspectRatio: z.string().optional(),
  imageResolution: z.enum(['1K', '2K', '4K']).optional(),
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
  thinkingLevel: z.enum(['low', 'high']).optional(),
  urlContext: z.boolean().optional(),
  useModelBuiltinSearch: z.boolean().optional(),
});
