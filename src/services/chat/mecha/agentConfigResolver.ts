import { BUILTIN_AGENT_SLUGS, getAgentRuntimeConfig } from '@lobechat/builtin-agents';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import {
  type LobeAgentChatConfig,
  type LobeAgentConfig,
  type MessageMapScope,
} from '@lobechat/types';
import { produce } from 'immer';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

/**
 * Applies params adjustments based on chatConfig settings.
 *
 * This function handles the conditional enabling/disabling of certain params:
 * - max_tokens: Only included if chatConfig.enableMaxTokens is true
 * - reasoning_effort: Only included if chatConfig.enableReasoningEffort is true
 *
 * Uses immer to create a new object without mutating the original.
 */
const applyParamsFromChatConfig = (
  agentConfig: LobeAgentConfig,
  chatConfig: LobeAgentChatConfig,
): LobeAgentConfig => {
  // If params is not defined, return agentConfig as-is
  if (!agentConfig.params) {
    return agentConfig;
  }

  return produce(agentConfig, (draft) => {
    // Only include max_tokens if enableMaxTokens is true
    draft.params.max_tokens = chatConfig.enableMaxTokens ? draft.params.max_tokens : undefined;

    // Only include reasoning_effort if enableReasoningEffort is true
    draft.params.reasoning_effort = chatConfig.enableReasoningEffort
      ? draft.params.reasoning_effort
      : undefined;
  });
};

/**
 * Runtime context for resolving agent config
 */
export interface AgentConfigResolverContext {
  /** Agent ID to resolve config for */
  agentId: string;

  // Builtin agent specific context
/** Document content for page-agent */
  documentContent?: string;

  /** Current model being used (for template variables) */
  model?: string;
  /** Plugins enabled for the agent */
  plugins?: string[];

  /** Current provider */
  provider?: string;

  /** Message map scope (e.g., 'page', 'main', 'thread') */
  scope?: MessageMapScope;
  /** Target agent config for agent-builder */
  targetAgentConfig?: LobeAgentConfig;
}

/**
 * Resolved agent config with runtime values merged
 */
export interface ResolvedAgentConfig {
  /** The resolved agent config */
  agentConfig: LobeAgentConfig;
  /** The chat config */
  chatConfig: LobeAgentChatConfig;
  /** Whether this is a builtin agent */
  isBuiltinAgent: boolean;
  /**
   * Final merged plugins for the agent
   * For builtin agents: runtime plugins (if any) or fallback to agent config plugins
   * For regular agents: agent config plugins
   */
  plugins: string[];
  /** The agent's slug (if builtin) */
  slug?: string;
}

/**
 * Resolves the agent config, merging runtime config for builtin agents
 *
 * For builtin agents (identified by slug), this will:
 * 1. Get the base config from the agent store
 * 2. Get the runtime config from @lobechat/builtin-agents
 * 3. Merge the runtime systemRole into the agent config
 *
 * For regular agents, this simply returns the config from the store.
 */
export const resolveAgentConfig = (ctx: AgentConfigResolverContext): ResolvedAgentConfig => {
  const { agentId, model, documentContent, plugins, targetAgentConfig } = ctx;

  const agentStoreState = getAgentStoreState();

  // Get base config from store
  const agentConfig = agentSelectors.getAgentConfigById(agentId)(agentStoreState);
  const chatConfig = chatConfigByIdSelectors.getChatConfigById(agentId)(agentStoreState);

  // Base plugins from agent config
  const basePlugins = agentConfig.plugins ?? [];

  // Check if this is a builtin agent
  const slug = agentSelectors.getAgentSlugById(agentId)(agentStoreState);

  if (!slug) {
    // Regular agent - use provided plugins if available, fallback to agent's plugins
    const finalPlugins = plugins && plugins.length > 0 ? plugins : basePlugins;

    // Apply params adjustments based on chatConfig
    let finalAgentConfig = applyParamsFromChatConfig(agentConfig, chatConfig);
    let finalChatConfig = chatConfig;

    // === Page Editor Auto-Injection ===
    // When custom agent is used in page editor (scope === 'page'),
    // automatically inject page-agent tools and system role
    if (ctx.scope === 'page') {
      // 1. Inject page-agent tool if not already present
      const pageAgentPlugins = finalPlugins.includes(PageAgentIdentifier)
        ? finalPlugins
        : [PageAgentIdentifier, ...finalPlugins];

      // 2. Get page-agent system prompt from builtin agent runtime
      const pageAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.pageAgent, {});
      const pageAgentSystemRole = pageAgentRuntime?.systemRole || '';

      // 3. Merge system roles: custom agent's role + page-agent role
      // Only append page-agent role if it exists
      const mergedSystemRole = pageAgentSystemRole
        ? agentConfig.systemRole
          ? `${agentConfig.systemRole}\n\n${pageAgentSystemRole}`
          : pageAgentSystemRole
        : agentConfig.systemRole || '';

      finalAgentConfig = {
        ...finalAgentConfig,
        systemRole: mergedSystemRole,
      };

      // 4. Apply chatConfig overrides (same as builtin page-copilot)
      finalChatConfig = {
        ...chatConfig,
        enableHistoryCount: false, // Disable history truncation for full document context
      };

      return {
        agentConfig: finalAgentConfig,
        chatConfig: finalChatConfig,
        isBuiltinAgent: false,
        plugins: pageAgentPlugins,
      };
    }

    // Not in page scope - return standard config
    return {
      agentConfig: finalAgentConfig,
      chatConfig: finalChatConfig,
      isBuiltinAgent: false,
      plugins: finalPlugins,
    };
  }

  // Build groupSupervisorContext if this is a group-supervisor agent
  let groupSupervisorContext;
  if (slug === BUILTIN_AGENT_SLUGS.groupSupervisor) {
    const groupStoreState = getChatGroupStoreState();
    // Find the group by supervisor agent ID
    const group = agentGroupSelectors.getGroupBySupervisorAgentId(agentId)(groupStoreState);

    if (group) {
      const groupMembers = agentGroupSelectors.getGroupMembers(group.id)(groupStoreState);
      groupSupervisorContext = {
        availableAgents: groupMembers.map((agent) => ({ id: agent.id, title: agent.title })),
        groupId: group.id,
        groupTitle: group.title || 'Group Chat',
        systemPrompt: group.config?.systemPrompt,
      };
    }
  }

  // Builtin agent - merge runtime config
  const runtimeConfig = getAgentRuntimeConfig(slug, {
    documentContent,
    groupSupervisorContext,
    model,
    plugins,
    targetAgentConfig,
  });

  // Merge runtime systemRole into agent config
  let resolvedSystemRole = runtimeConfig?.systemRole ?? agentConfig.systemRole;

  // Merge plugins: runtime plugins take priority, fallback to base plugins
  let finalPlugins =
    runtimeConfig?.plugins && runtimeConfig.plugins.length > 0
      ? runtimeConfig.plugins
      : basePlugins;

  // Merge chatConfig: runtime chatConfig overrides base chatConfig
  let resolvedChatConfig: LobeAgentChatConfig = {
    ...chatConfig,
    ...runtimeConfig?.chatConfig,
  };

  // === Page Editor Auto-Injection for Builtin Agents ===
  // When a builtin agent (other than page-agent itself) is used in page editor,
  // inject page-agent tools and system role
  if (ctx.scope === 'page' && slug !== BUILTIN_AGENT_SLUGS.pageAgent) {
    // 1. Inject page-agent tool if not already present
    if (!finalPlugins.includes(PageAgentIdentifier)) {
      finalPlugins = [PageAgentIdentifier, ...finalPlugins];
    }

    // 2. Get page-agent system prompt
    const pageAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.pageAgent, {});
    const pageAgentSystemRole = pageAgentRuntime?.systemRole || '';

    // 3. Merge system roles: builtin agent's role + page-agent role
    if (pageAgentSystemRole) {
      resolvedSystemRole = resolvedSystemRole
        ? `${resolvedSystemRole}\n\n${pageAgentSystemRole}`
        : pageAgentSystemRole;
    }

    // 4. Apply chatConfig overrides
    resolvedChatConfig = {
      ...resolvedChatConfig,
      enableHistoryCount: false,
    };
  }

  // Merge runtime systemRole into agent config
  const resolvedAgentConfig: LobeAgentConfig = {
    ...agentConfig,
    systemRole: resolvedSystemRole,
  };

  // Apply params adjustments based on chatConfig
  const finalAgentConfig = applyParamsFromChatConfig(resolvedAgentConfig, resolvedChatConfig);

  return {
    agentConfig: finalAgentConfig,
    chatConfig: resolvedChatConfig,
    isBuiltinAgent: true,
    plugins: finalPlugins,
    slug,
  };
};

/**
 * Get the target agent ID, falling back to active agent if not provided
 */
export const getTargetAgentId = (agentId?: string): string => {
  const agentStoreState = getAgentStoreState();
  return agentId || agentStoreState.activeAgentId || '';
};
