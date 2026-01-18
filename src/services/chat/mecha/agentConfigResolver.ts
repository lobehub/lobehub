import { BUILTIN_AGENT_SLUGS, getAgentRuntimeConfig } from '@lobechat/builtin-agents';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import {
  type LobeAgentChatConfig,
  type LobeAgentConfig,
  type MessageMapScope,
} from '@lobechat/types';
import debug from 'debug';
import { produce } from 'immer';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { agentGroupByIdSelectors, agentGroupSelectors } from '@/store/agentGroup/selectors';

const log = debug('mecha:agentConfigResolver');

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

  /**
   * Group ID for supervisor detection.
   * When provided, used for direct lookup instead of iterating all groups.
   */
  groupId?: string;

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

  log('resolveAgentConfig called with agentId: %s, scope: %s', agentId, ctx.scope);

  const agentStoreState = getAgentStoreState();

  // Get base config from store
  const agentConfig = agentSelectors.getAgentConfigById(agentId)(agentStoreState);
  const chatConfig = chatConfigByIdSelectors.getChatConfigById(agentId)(agentStoreState);

  // Base plugins from agent config
  const basePlugins = agentConfig.plugins ?? [];

  // Check if this is a builtin agent
  // First check agent store, then check if this is a supervisor agent via groupId
  let slug = agentSelectors.getAgentSlugById(agentId)(agentStoreState);
  log('slug from agentStore: %s (agentId: %s)', slug, agentId);

  // If not found in agent store, check if this is a supervisor agent using groupId
  // This is more reliable than iterating all groups to find a match
  if (!slug && ctx.groupId) {
    const groupStoreState = getChatGroupStoreState();
    const group = agentGroupByIdSelectors.groupById(ctx.groupId)(groupStoreState);

    log(
      'checking supervisor via groupId %s: group=%o',
      ctx.groupId,
      group
        ? {
            groupId: group.id,
            supervisorAgentId: group.supervisorAgentId,
            title: group.title,
          }
        : null,
    );

    // Check if this agent is the supervisor of the specified group
    if (group?.supervisorAgentId === agentId) {
      slug = BUILTIN_AGENT_SLUGS.groupSupervisor;
      log(
        'agentId %s identified as group supervisor for group %s, assigned slug: %s',
        agentId,
        ctx.groupId,
        slug,
      );
    }
  }

  if (!slug) {
    log('agentId %s is not a builtin agent (no slug found)', agentId);
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
  // Use groupId for direct lookup instead of reverse lookup by supervisorAgentId
  let groupSupervisorContext;
  if (slug === BUILTIN_AGENT_SLUGS.groupSupervisor && ctx.groupId) {
    log('building groupSupervisorContext for agentId: %s, groupId: %s', agentId, ctx.groupId);
    const groupStoreState = getChatGroupStoreState();
    // Direct lookup using groupId
    const group = agentGroupByIdSelectors.groupById(ctx.groupId)(groupStoreState);

    log(
      'groupById result for %s: %o',
      ctx.groupId,
      group
        ? {
            agentsCount: group.agents?.length,
            groupId: group.id,
            supervisorAgentId: group.supervisorAgentId,
            title: group.title,
          }
        : null,
    );

    if (group) {
      const groupMembers = agentGroupSelectors.getGroupMembers(group.id)(groupStoreState);
      log(
        'groupMembers for groupId %s: %o',
        group.id,
        groupMembers.map((m) => ({ id: m.id, isSupervisor: m.isSupervisor, title: m.title })),
      );

      groupSupervisorContext = {
        availableAgents: groupMembers.map((agent) => ({ id: agent.id, title: agent.title })),
        groupId: group.id,
        groupTitle: group.title || 'Group Chat',
        systemPrompt: agentConfig.systemRole,
      };
      log('groupSupervisorContext built: %o', {
        availableAgentsCount: groupSupervisorContext.availableAgents.length,
        groupId: groupSupervisorContext.groupId,
        groupTitle: groupSupervisorContext.groupTitle,
        hasSystemPrompt: !!groupSupervisorContext.systemPrompt,
      });
    } else {
      log('WARNING: group not found for groupId: %s', ctx.groupId);
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

  log('resolveAgentConfig completed for agentId: %s, result: %o', agentId, {
    isBuiltinAgent: true,
    pluginsCount: finalPlugins.length,
    slug,
  });

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
