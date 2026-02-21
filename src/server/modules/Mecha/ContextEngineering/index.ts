import { MessagesEngine } from '@lobechat/context-engine';
import { type OpenAIChatMessage } from '@lobechat/types';

import { type ServerMessagesEngineParams } from './types';

/**
 * Create server-side variable generators with runtime context
 * These are safe to use in Node.js environment
 */
const createServerVariableGenerators = (model?: string, provider?: string) => ({
  // Time-related variables
  date: () => new Date().toLocaleDateString('en-US', { dateStyle: 'full' }),
  datetime: () => new Date().toISOString(),
  time: () => new Date().toLocaleTimeString('en-US', { timeStyle: 'medium' }),
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  // Model-related variables
  model: () => model ?? '',
  provider: () => provider ?? '',
});

/**
 * Server-side messages engine function
 *
 * This function wraps MessagesEngine for server-side usage.
 * Unlike the frontend version, it receives all data as parameters
 * instead of fetching from stores.
 *
 * @example
 * ```typescript
 * const messages = await serverMessagesEngine({
 *   messages: chatMessages,
 *   model: 'gpt-4',
 *   provider: 'openai',
 *   systemRole: 'You are a helpful assistant',
 *   knowledge: {
 *     fileContents: [...],
 *     knowledgeBases: [...],
 *   },
 * });
 * ```
 */
export const serverMessagesEngine = async ({
  messages = [],
  model,
  provider,
  systemRole,
  inputTemplate,
  enableHistoryCount,
  historyCount,
  historySummary,
  formatHistorySummary,
  knowledge,
  toolsConfig,
  capabilities,
  userMemory,
  agentBuilderContext,
  pageContentContext,
}: ServerMessagesEngineParams): Promise<OpenAIChatMessage[]> => {
  const engine = new MessagesEngine({
    // Capability injection
    capabilities: {
      isCanUseFC: capabilities?.isCanUseFC,
      isCanUseVideo: capabilities?.isCanUseVideo,
      isCanUseVision: capabilities?.isCanUseVision,
    },

    // Agent configuration
    enableHistoryCount,

    // File context configuration (server always includes file URLs)
    fileContext: { enabled: true, includeFileUrl: true },

    formatHistorySummary,

    historyCount,

    historySummary,

    inputTemplate,

    // Knowledge injection
    knowledge: {
      fileContents: knowledge?.fileContents,
      knowledgeBases: knowledge?.knowledgeBases,
    },

    // Messages
    messages,

    // Model info
    model,

    provider,
    systemRole,

    // Tools configuration
    toolsConfig: {
      manifests: toolsConfig?.manifests,
      tools: toolsConfig?.tools,
    },

    // User memory configuration
    userMemory: userMemory?.memories
      ? {
          enabled: true,
          fetchedAt: userMemory.fetchedAt,
          memories: userMemory.memories,
        }
      : undefined,

    // Server-side variable generators (with model/provider context)
    variableGenerators: createServerVariableGenerators(model, provider),

    // Extended contexts
    ...(agentBuilderContext && { agentBuilderContext }),
    ...(pageContentContext && { pageContentContext }),
  });

  const result = await engine.process();
  return result.messages;
};

// Re-export types
export type {
  ServerKnowledgeConfig,
  ServerMessagesEngineParams,
  ServerModelCapabilities,
  ServerToolsConfig,
  ServerUserMemoryConfig,
} from './types';
