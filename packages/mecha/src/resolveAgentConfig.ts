import { type BuiltinAgentSlug } from '@lobechat/builtin-agents';
import {
  BUILTIN_AGENT_SLUGS,
  getAgentRuntimeConfig,
  isCollaborativeBuiltinAgentRow,
} from '@lobechat/builtin-agents';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { type LobeToolManifest } from '@lobechat/context-engine';
import {
  type AgentModelConfig,
  type AgentModelOverride,
  type ChatCompletionTool,
  getActivePluginIds,
  type LobeAgentChatConfig,
  type LobeAgentConfig,
  type MessageMapScope,
  resolveAgentModelConfig,
} from '@lobechat/types';
import debug from 'debug';
import { produce } from 'immer';

const log = debug('mecha:agentConfigResolver');

/**
 * Set of valid builtin agent slugs for O(1) lookup
 */
const VALID_BUILTIN_SLUGS = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Check if a slug is a valid builtin agent slug
 */
const isBuiltinAgentSlug = (slug: string): slug is BuiltinAgentSlug => {
  return VALID_BUILTIN_SLUGS.has(slug);
};

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
  if (!agentConfig?.params) {
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
/**
 * Everything the resolution rules read from outside themselves.
 *
 * The rules below used to reach into the browser's Zustand stores directly,
 * which is why the server had to re-implement them against its own database
 * models. Hoisting the reads into one value is what lets a single
 * implementation serve the browser, the server, and a device: each host
 * gathers this however it can, and none of the rules know the difference.
 *
 * Deliberately plain data. `canManage` in particular is an INPUT, not
 * something computed here — the browser answers it from a cache the picker
 * populates, the server from `isResourceAuthorOrAdmin`, and one of those is
 * asynchronous.
 */
export interface AgentConfigSnapshot {
  /** The agent row: naming, and the fields the ownership rules read. */
  agent?: {
    name?: string | null;
    /**
     * The row's own slug. With `virtual` and `workspaceId` this is what marks a
     * COLLABORATIVE builtin, whose members each keep a personal model choice.
     *
     * The same value as the top-level `slug` in practice, but a separate read —
     * that one resolves the builtin identity, this one discriminates the row.
     * Kept apart because the rules read them for different purposes and a host
     * may legitimately know one without the other.
     */
    slug?: string | null;
    title?: string | null;
    userId?: string | null;
    /** Written by provisioning; a legacy row merely holding a reserved slug is not collaborative. */
    virtual?: boolean | null;
    visibility?: AgentModelConfig['visibility'];
    workspaceId?: string | null;
  };
  /** The agent's stored config, before runtime merging. */
  agentConfig: LobeAgentConfig;
  /** Author-or-admin for this agent; see the interface doc. */
  canManage: boolean;
  /** The agent's stored chat config. */
  chatConfig: LobeAgentChatConfig;
  /** The group named by `groupId`, when the caller is running in group scope. */
  group?: {
    agents?: unknown[];
    id: string;
    supervisorAgentId?: string | null;
    title?: string | null;
  };
  /** The group's members, for the supervisor's roster of who it can call. */
  groupMembers?: { id: string; isSupervisor?: boolean; title?: string | null }[];
  /** Development build — reaches builtin agents as a prompt flag. */
  isDev?: boolean;
  /** Workspace member's own model pick, when one applies. */
  memberModelOverride?: AgentModelOverride | null;
  /** Workspace member's own mode pick, when one applies. */
  memberModeOverride?: LobeAgentChatConfig['enableAgentMode'];
  /**
   * The agent's slug, which identifies a builtin agent — and, together with
   * `agent.virtual` and `agent.workspaceId`, a COLLABORATIVE one whose members
   * each keep a personal model choice. A host that cannot express all three
   * classifies every collaborative builtin as an ordinary agent, silently
   * handing its members the workspace-shared model instead of their own.
   *
   * Resolves the builtin identity. `agent.slug` discriminates the row for the
   * collaborative rule; the two hold the same value but are separate reads.
   */
  slug?: string;
  /** The user's preferred reply language, injected into the system role. */
  userLocale?: string;
}

export interface AgentConfigResolverContext {
  /** Agent ID to resolve config for */
  agentId: string;

  /**
   * Whether to disable all tools for this agent execution.
   * When true, returns empty plugins array (used for broadcast scenarios).
   */
  disableTools?: boolean;

  // Builtin agent specific context
  /** Document content for page-agent */
  documentContent?: string;

  /**
   * Group ID for supervisor detection.
   * When provided, used for direct lookup instead of iterating all groups.
   */
  groupId?: string;

  /**
   * Whether this is a sub-agent execution.
   * When true, filters out the lobe-agent tool (which owns the sub-agent
   * dispatch APIs) to prevent nested sub-agent creation.
   */
  isSubAgent?: boolean;

  /** Current model being used (for template variables); defaults to the resolved model. */
  model?: string;
  /**
   * Per-call model / provider pinned by the caller (task or sub-agent spawn,
   * an explicit request override). Outranks the member's personal choice and
   * the shared default.
   */
  modelOverride?: Partial<AgentModelOverride> | null;
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
  /** Enabled manifests for context engineering (populated by internal_createAgentState) */
  enabledManifests?: LobeToolManifest[];
  /** Enabled tool IDs after filtering (populated by internal_createAgentState) */
  enabledToolIds?: string[];
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
  /**
   * The raw sub-agent chatConfig override (`agencyConfig.subagent.chatConfig`).
   * `chatConfig` above already has it merged in for non-migrated fields; this
   * copy lets the model-params resolver re-apply the user's explicit sub-agent
   * reasoning choices on top of the model-instance defaults.
   */
  subAgentChatConfigOverride?: Partial<LobeAgentChatConfig>;
  /** Pre-generated tools array (populated by internal_createAgentState, undefined means tools disabled) */
  tools?: ChatCompletionTool[];
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
export const resolveAgentConfig = (
  ctx: AgentConfigResolverContext,
  snapshot: AgentConfigSnapshot,
): ResolvedAgentConfig => {
  const {
    agentId,
    documentContent,
    plugins,
    targetAgentConfig,
    isSubAgent,
    disableTools,
    modelOverride,
  } = ctx;

  log(
    'resolveAgentConfig called with agentId: %s, scope: %s, isSubAgent: %s, disableTools: %s',
    agentId,
    ctx.scope,
    isSubAgent,
    disableTools,
  );

  // Helper to apply plugin filters:
  // 1. If disableTools is true, return empty array (for broadcast scenarios)
  // 2. Drop page-agent outside page scope.
  //
  // lobe-agent's context trimming (hide `callSubAgent` in group / sub-agent runs)
  // now lives in its manifest resolver (resolveLobeAgentManifest), applied at
  // tools-engine build time. That keeps lobe-agent's plan / todo / media-analysis
  // available to sub-agents — only the nested dispatch API is removed — instead of
  // dropping the whole tool here.
  const applyPluginFilters = (pluginIds: string[]) => {
    if (disableTools) {
      log('disableTools is true, returning empty plugins');
      return [];
    }

    let nextPluginIds = pluginIds;

    if (ctx.scope !== 'page') {
      nextPluginIds = nextPluginIds.filter((id) => id !== PageAgentIdentifier);
    }

    return nextPluginIds;
  };

  const { agent, agentConfig: sharedAgentConfig } = snapshot;
  // Author-or-admin, mirroring the picker (`useAgentManagementAccess`) and the
  // server (`isResourceAuthorOrAdmin`) — an admin reads the shared row like
  // the author does, so client and gateway execution resolve the same config.
  const { canManage } = snapshot;
  const isPublicWorkspaceAgent = !!agent?.workspaceId && agent.visibility !== 'private';
  // A collaborative builtin has no real author (the row is provisioned by
  // whoever opened the feature first), so its *model* stays personal even for
  // that member — see `AgentModelConfig.personalModelSelection`. Chat/Agent mode
  // keeps the ordinary author rule.
  // Spelled out rather than passed the whole row: these three fields are the
  // entire contract, and a host filling the snapshot has to see that.
  const personalModelSelection = isCollaborativeBuiltinAgentRow({
    slug: agent?.slug,
    virtual: agent?.virtual,
    workspaceId: agent?.workspaceId,
  });
  const usesWorkspaceMemberSelection = isPublicWorkspaceAgent && !canManage;
  const memberModelOverride =
    isPublicWorkspaceAgent && (personalModelSelection || !canManage)
      ? snapshot.memberModelOverride
      : undefined;
  const memberModeOverride = usesWorkspaceMemberSelection ? snapshot.memberModeOverride : undefined;
  const agentConfig = {
    ...sharedAgentConfig,
    ...resolveAgentModelConfig(
      {
        ...sharedAgentConfig,
        canManage,
        personalModelSelection,
        visibility: agent?.visibility,
        workspaceId: agent?.workspaceId,
      },
      memberModelOverride,
      modelOverride,
    ),
  };
  // Runtime templates render `{{model}}` for the model the run will actually use.
  const model = ctx.model ?? agentConfig.model;
  const sharedChatConfig = snapshot.chatConfig;
  const chatConfig =
    memberModeOverride === undefined
      ? sharedChatConfig
      : { ...sharedChatConfig, enableAgentMode: memberModeOverride };

  // Base plugins from agent config (pinned identifiers only — disabled entries excluded)
  const basePlugins = getActivePluginIds(agentConfig?.plugins);

  // Check if this is a builtin agent
  // Priority: supervisor check (when in group scope) > agent store slug
  let slug: string | undefined;

  // IMPORTANT: When in group scope with groupId, check if this agent is the group's supervisor FIRST
  // This takes priority because supervisor needs special group-supervisor behavior,
  // even if the agent has its own slug
  if (ctx.groupId && ctx.scope === 'group') {
    const { group } = snapshot;

    log(
      'checking supervisor FIRST (scope=group): groupId=%s, group=%O, agentId=%s',
      ctx.groupId,
      group
        ? {
            groupId: group.id,
            supervisorAgentId: group.supervisorAgentId,
            title: group.title,
          }
        : null,
      agentId,
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

  // If not identified as supervisor, check agent store for slug
  if (!slug) {
    const storeSlug = snapshot.slug;
    log('slug from agentStore: %s (agentId: %s)', storeSlug, agentId);

    // Only use the slug if it's a valid builtin agent slug
    // Regular agents may have random slugs that should be ignored
    if (storeSlug && isBuiltinAgentSlug(storeSlug)) {
      slug = storeSlug;
    } else if (storeSlug) {
      log('slug %s is not a valid builtin agent slug, treating as regular agent', storeSlug);
    }
  }

  if (!slug) {
    log('agentId %s is not a builtin agent (no valid builtin slug found)', agentId);
    // Regular agent - use provided plugins if available, fallback to agent's plugins
    const finalPlugins = plugins && plugins.length > 0 ? plugins : basePlugins;

    // Inject response language preference into system role for regular agents
    const { userLocale } = snapshot;
    const localeInstruction = userLocale
      ? `Preferred reply language: ${userLocale}. Use this language unless the user explicitly asks to switch.`
      : '';
    const systemRoleWithLocale = localeInstruction
      ? agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${localeInstruction}`
        : localeInstruction
      : agentConfig.systemRole;

    // Apply params adjustments based on chatConfig
    let finalAgentConfig = applyParamsFromChatConfig(
      { ...agentConfig, systemRole: systemRoleWithLocale },
      chatConfig,
    );
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

      // 3. Merge system roles: custom agent's role (with locale) + page-agent role
      // Only append page-agent role if it exists
      const mergedSystemRole = pageAgentSystemRole
        ? systemRoleWithLocale
          ? `${systemRoleWithLocale}\n\n${pageAgentSystemRole}`
          : pageAgentSystemRole
        : systemRoleWithLocale || '';

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
        plugins: applyPluginFilters(pageAgentPlugins),
      };
    }

    if (ctx.scope === 'task') {
      const taskAgentPlugins = finalPlugins.includes(TaskIdentifier)
        ? finalPlugins
        : [TaskIdentifier, ...finalPlugins];
      const taskAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.taskAgent, {});
      const taskAgentSystemRole = taskAgentRuntime?.systemRole || '';
      const mergedSystemRole = taskAgentSystemRole
        ? systemRoleWithLocale
          ? `${systemRoleWithLocale}\n\n${taskAgentSystemRole}`
          : taskAgentSystemRole
        : systemRoleWithLocale || '';

      finalAgentConfig = {
        ...finalAgentConfig,
        systemRole: mergedSystemRole,
      };

      return {
        agentConfig: finalAgentConfig,
        chatConfig: finalChatConfig,
        isBuiltinAgent: false,
        plugins: applyPluginFilters(taskAgentPlugins),
      };
    }

    // Not in page scope - return standard config
    return {
      agentConfig: finalAgentConfig,
      chatConfig: finalChatConfig,
      isBuiltinAgent: false,
      plugins: applyPluginFilters(finalPlugins),
    };
  }

  // Build groupSupervisorContext if this is a group-supervisor agent
  // Use groupId for direct lookup instead of reverse lookup by supervisorAgentId
  let groupSupervisorContext;
  if (slug === BUILTIN_AGENT_SLUGS.groupSupervisor && ctx.groupId) {
    log('building groupSupervisorContext for agentId: %s, groupId: %s', agentId, ctx.groupId);
    const { group } = snapshot;

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
      const groupMembers = snapshot.groupMembers ?? [];
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
  // Use basePlugins as fallback when ctx.plugins is not provided
  // This ensures builtin agents (e.g., INBOX) receive user-configured plugins for merging
  const runtimeConfig = getAgentRuntimeConfig(slug, {
    // The renameable default assistant must introduce itself by the name the
    // user gave it, not the hardcoded product default.
    agentName: agent?.name ?? undefined,
    agentTitle: agent?.title ?? undefined,
    documentContent,
    groupSupervisorContext,
    isDev: snapshot.isDev ?? false,
    model,
    plugins: plugins || basePlugins,
    storedSystemRole: agentConfig.systemRole || undefined,
    targetAgentConfig,
    userLocale: snapshot.userLocale,
  });

  // The runtime prompt is the authority for a builtin; a builtin that treats
  // it as a user-editable default reads `storedSystemRole` itself (inbox).
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
  const resolvedAgencyConfig = runtimeConfig?.agencyConfig
    ? {
        ...agentConfig.agencyConfig,
        ...runtimeConfig.agencyConfig,
      }
    : agentConfig.agencyConfig;

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

  if (ctx.scope === 'task' && slug !== BUILTIN_AGENT_SLUGS.taskAgent) {
    if (!finalPlugins.includes(TaskIdentifier)) {
      finalPlugins = [TaskIdentifier, ...finalPlugins];
    }

    const taskAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.taskAgent, {});
    const taskAgentSystemRole = taskAgentRuntime?.systemRole || '';

    if (taskAgentSystemRole) {
      resolvedSystemRole = resolvedSystemRole
        ? `${resolvedSystemRole}\n\n${taskAgentSystemRole}`
        : taskAgentSystemRole;
    }
  }

  // Merge runtime systemRole into agent config
  const resolvedAgentConfig: LobeAgentConfig = {
    ...agentConfig,
    ...(resolvedAgencyConfig ? { agencyConfig: resolvedAgencyConfig } : {}),
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
    plugins: applyPluginFilters(finalPlugins),
    slug,
  };
};

/**
 * Get the target agent ID, falling back to active agent if not provided
 */
