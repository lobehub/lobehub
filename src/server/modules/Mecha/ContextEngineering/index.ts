import { MessagesEngine } from '@lobechat/context-engine';
import { type OpenAIChatMessage } from '@lobechat/types';

import { type ServerMessagesEngineParams } from './types';

/**
 * Create server-side variable generators with runtime context
 * These are safe to use in Node.js environment
 */
const createServerVariableGenerators = (params: {
  model?: string;
  provider?: string;
  timezone?: string;
}) => {
  const { model, provider, timezone } = params;
  const tz = timezone || 'UTC';
  return {
    // Time-related variables (localized to user's timezone)
    date: () => new Date().toLocaleDateString('en-US', { dateStyle: 'full', timeZone: tz }),
    datetime: () => new Date().toLocaleString('en-US', { timeZone: tz }),
    time: () => new Date().toLocaleTimeString('en-US', { timeStyle: 'medium', timeZone: tz }),
    timezone: () => tz,
    // Model-related variables
    model: () => model ?? '',
    provider: () => provider ?? '',
  };
};

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
  forceFinish,
  historyCount,
  historySummary,
  formatHistorySummary,
  knowledge,
  agentDocuments,
  skillsConfig,
  toolDiscoveryConfig,
  toolsConfig,
  capabilities,
  userMemory,
  agentBuilderContext,
  botPlatformContext,
  discordContext,
  evalContext,
  agentManagementContext,
  pageContentContext,
  topicReferences,
  additionalVariables,
  userTimezone,
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

    // Force finish mode (inject summary prompt when maxSteps exceeded)
    forceFinish,

    formatHistorySummary,

    historyCount,

    historySummary,

    inputTemplate,

    // Knowledge injection
    knowledge: {
      fileContents: knowledge?.fileContents,
      knowledgeBases: knowledge?.knowledgeBases,
    },
    agentDocuments,

    // Messages
    messages,

    // Model info
    model,

    provider,
    systemRole,

    // Timezone for system date provider
    timezone: userTimezone,

    // Tools configuration
    toolDiscoveryConfig,
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

    // Server-side variable generators (with model/provider context + device paths)
    variableGenerators: {
      ...createServerVariableGenerators({ model, provider, timezone: userTimezone }),
      ...Object.fromEntries(
        Object.entries(additionalVariables ?? {}).map(([k, v]) => [k, () => v]),
      ),
    },

    // Skills configuration
    ...(skillsConfig?.enabledSkills && skillsConfig.enabledSkills.length > 0 && { skillsConfig }),

    // Topic references
    ...(topicReferences && topicReferences.length > 0 && { topicReferences }),

    // Extended contexts
    ...(agentBuilderContext && { agentBuilderContext }),
    ...(botPlatformContext && { botPlatformContext }),
    ...(discordContext && { discordContext }),
    ...(evalContext && { evalContext }),
    ...(agentManagementContext && { agentManagementContext }),
    ...(pageContentContext && { pageContentContext }),
  });

  const result = await engine.process();
  return result.messages;
};

// Re-export types
export type {
  BotPlatformContext,
  EvalContext,
  ServerKnowledgeConfig,
  ServerMessagesEngineParams,
  ServerModelCapabilities,
  ServerToolsConfig,
  ServerUserMemoryConfig,
} from './types';
