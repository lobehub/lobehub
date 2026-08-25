import { getShellSyntaxGuidance } from '@lobechat/builtin-tool-local-system';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
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
  // Wall-clock components in the user's timezone. The client generators read them
  // off a local Date (2-digit, 24h) — h23 keeps midnight as "00" instead of "24".
  const timeParts = (): Record<string, string> => {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: tz,
      year: 'numeric',
    }).formatToParts(new Date());
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  };
  return {
    // Time-related variables (localized to user's timezone), mirroring the client
    // VARIABLE_GENERATORS set so no temporal placeholder leaks as a literal in
    // server-side runs. Prefer the coarse ones ({{date}}, {{hour}}) in system
    // prompts: fine-grained values change every request and break prompt caching.
    date: () => new Date().toLocaleDateString('en-US', { dateStyle: 'full', timeZone: tz }),
    datetime: () => new Date().toLocaleString('en-US', { timeZone: tz }),
    day: () => timeParts().day,
    hour: () => timeParts().hour,
    iso: () => new Date().toISOString(),
    // The client resolves {{locale}} from the browser (Intl resolvedOptions). The
    // server has no request locale here — the user's configured response language
    // arrives via `additionalVariables` and overrides this through the spread
    // order below; without it, fall back to the same default as
    // UserModel.getInfoForAIGeneration instead of leaking the literal token.
    locale: () => 'en-US',
    minute: () => timeParts().minute,
    month: () => timeParts().month,
    second: () => timeParts().second,
    time: () => new Date().toLocaleTimeString('en-US', { timeStyle: 'medium', timeZone: tz }),
    timestamp: () => Date.now().toString(),
    timezone: () => tz,
    weekday: () => new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' }),
    year: () => timeParts().year,
    // Model-related variables
    model: () => model ?? '',
    provider: () => provider ?? '',
    // Working directory fallback. Unlike the client generator, the server has no
    // store to resolve cwd from — the real value arrives via `additionalVariables`
    // (`deviceSystemInfo.workingDirectory`, only set when a device-run's bound cwd
    // resolves) and overrides this through the spread order below. Without this
    // fallback, a device-run whose cwd can't be resolved (e.g. a web-originated
    // session with no bound directory) leaves `{{workingDirectory}}` unmatched and
    // leaks the literal into the local-system system prompt.
    workingDirectory: () => '(not specified, use user Home directory as default)',
    // Same leak-guard as workingDirectory: the real value arrives via
    // `additionalVariables` (deviceSystemInfo.defaultShell) and overrides this.
    // Without a device-reported value, describe the platform default instead of
    // leaking the literal `{{defaultShell}}` token into the prompt.
    defaultShell: () =>
      'the platform default shell (PowerShell on Windows, /bin/sh on macOS/Linux)',
    // Same leak-guard for the paired syntax-guidance placeholder; passing
    // undefined yields the shell-agnostic wording.
    shellSyntaxGuidance: () => getShellSyntaxGuidance(undefined),
    // Leak-guards for the device identity/path placeholders in the local-system
    // system role. Real values arrive via `additionalVariables` (device system
    // info) and override these; without a device report, tell the model the
    // value is unknown instead of leaking the literal `{{...}}` token.
    arch: () => 'unknown',
    hostname: () => 'unknown',
    platform: () => 'unknown',
    desktopPath: () => '(not reported)',
    documentsPath: () => '(not reported)',
    downloadsPath: () => '(not reported)',
    homePath: () => '(not reported)',
    musicPath: () => '(not reported)',
    picturesPath: () => '(not reported)',
    userDataPath: () => '(not reported)',
    videosPath: () => '(not reported)',
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
  additionalContexts,
  messages = [],
  model,
  modelDisplayName,
  modelKnowledgeCutoff,
  provider,
  systemRole,
  inputTemplate,
  enableAgentMode,
  enableExpertise,
  enableHistoryCount,
  forceFinish,
  historyCount,
  historySummary,
  formatHistorySummary,
  initialContext,
  knowledge,
  agentDocuments,
  skillsConfig,
  toolDiscoveryConfig,
  toolsConfig,
  capabilities,
  userMemory,
  agentBuilderContext,
  agentGroup,
  botPlatformContext,
  discordContext,
  evalContext,
  expertise,
  agentManagementContext,
  groupAgentBuilderContext,
  onboardingContext,
  pageContentContext,
  planTodo,
  topicReferences,
  additionalVariables,
  userTimezone,
}: ServerMessagesEngineParams): Promise<OpenAIChatMessage[]> => {
  const engine = new MessagesEngine({
    additionalContexts,
    // Capability injection
    capabilities: {
      isCanUseAudio: capabilities?.isCanUseAudio,
      isCanUseFC: capabilities?.isCanUseFC,
      isCanUseVideo: capabilities?.isCanUseVideo,
      isCanUseVision: capabilities?.isCanUseVision,
    },

    // Agent configuration
    enableAgentMode,
    enableExpertise,
    enableHistoryCount,
    expertise,

    // Server-side file access URLs resolve to stable file-proxy URLs in production.
    fileContext: { enabled: true, includeFileUrl: true },

    // Force finish mode (inject summary prompt when maxSteps exceeded)
    forceFinish,

    formatHistorySummary,

    historyCount,

    historySummary,

    inputTemplate,

    initialContext,

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
    modelDisplayName,
    modelKnowledgeCutoff,

    provider,
    planTodo,
    systemRole,

    // Timezone for system date provider
    timezone: userTimezone,

    // Tools configuration
    toolDiscoveryConfig,
    toolsConfig: {
      disabledToolIdentifiers:
        toolsConfig?.disabledToolIdentifiers ??
        (toolsConfig?.tools?.includes(PageAgentIdentifier) ? undefined : [PageAgentIdentifier]),
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
    ...(agentGroup && { agentGroup }),
    ...(botPlatformContext && { botPlatformContext }),
    ...(discordContext && { discordContext }),
    ...(evalContext && { evalContext }),
    ...(onboardingContext && { onboardingContext }),
    ...(agentManagementContext && { agentManagementContext }),
    ...(groupAgentBuilderContext && { groupAgentBuilderContext }),
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
