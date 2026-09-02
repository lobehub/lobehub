import {
  BUILTIN_AGENT_SLUGS,
  getAgentRuntimeConfig,
  isCollaborativeBuiltinAgentRow,
} from '@lobechat/builtin-agents';
import { LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { resolveSubAgentChatConfig } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { AgentModelOverride, LobeAgentAgencyConfig } from '@lobechat/types';
import {
  getActivePluginIds,
  getDisabledPluginIds,
  resolveAgentAgencyConfig,
  resolveAgentModelConfig,
} from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import type { AgentConfigWithId } from '@/server/services/agent';
import { isResourceAuthorOrAdmin } from '@/server/services/resourcePermission';

import type { InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface ResolveRunAgentConfigDeps {
  db: LobeChatDatabase;
  resolveAgentConfigOrThrow: (identifier: string) => Promise<AgentConfigWithId>;
  userId: string;
  workspaceId?: string;
}

export interface ResolveRunAgentConfigInput {
  appContext?: InternalExecAgentParams['appContext'];
  chatConfigOverride?: InternalExecAgentParams['chatConfigOverride'];
  /** Agent id or slug (agentId takes precedence at the call site). */
  identifier: string;
  instructions?: string;
  modelOverride?: string;
  providerOverride?: string;
  throwIfExecutionAborted: (stage: string) => Promise<void>;
  toolModeOverride?: InternalExecAgentParams['toolModeOverride'];
}

export interface ResolvedRunAgentConfig {
  /**
   * The MUTABLE effective config for this run. Later stages keep appending to
   * `systemRole` (connector ownership notes, project instructions) and
   * `createOperation` must see those writes — do not clone.
   */
  agentConfig: AgentConfigWithId;
  agentSlug?: string | null;
  /** Agent id stamped on the assistant row (conversation-aware). */
  assistantAgentId: string;
  canManageAgent: boolean;
  /** Agent id stamped on the user row (conversation-aware). */
  conversationAgentId: string;
  /** Tri-state disabled plugin identifiers, captured before pinned-id collapse. */
  disabledPluginIds: string[];
  isPublicWorkspaceAgent: boolean;
  memberDeviceOverride?: Pick<LobeAgentAgencyConfig, 'boundDeviceId' | 'executionTarget'>;
  /** Persistence-attribution agent id (Agent Signal marker aware). */
  persistAgentId: string;
  /** The actual executing agent row id resolved from id/slug. */
  resolvedAgentId: string;
}

/**
 * Stages 1–2.5 of {@link AiAgentService.execAgent}: resolve the effective agent
 * configuration for this run.
 *
 * Covers: config fetch (id or slug), per-(workspace, user) member overrides
 * (device / model / mode), author-or-admin management access, agency-config
 * resolution, callSubAgent chatConfig patches, the IM `/mode` override, the
 * persistence-attribution agent ids, final model resolution, builtin-agent
 * runtime merge, page/task scope injection, sub-agent tool stripping, and the
 * per-call `instructions` systemRole append.
 */
export const resolveRunAgentConfig = async (
  deps: ResolveRunAgentConfigDeps,
  input: ResolveRunAgentConfigInput,
): Promise<ResolvedRunAgentConfig> => {
  const {
    appContext,
    chatConfigOverride,
    identifier,
    instructions,
    modelOverride,
    providerOverride,
    throwIfExecutionAborted,
    toolModeOverride,
  } = input;

  // 1. Get agent configuration with default config merged (supports both id and slug)
  const agentConfig = await deps.resolveAgentConfigOrThrow(identifier);

  // Use actual agent ID from config for subsequent operations
  const resolvedAgentId = agentConfig.id;
  let memberDeviceOverride:
    Pick<LobeAgentAgencyConfig, 'boundDeviceId' | 'executionTarget'> | undefined;
  let memberModelOverride: AgentModelOverride | undefined;
  let memberModeOverride: boolean | undefined;

  // Layer this caller's workspace-scoped execution and model preferences over
  // the shared Agent row. Device selection keeps its existing fallback rules;
  // public Workspace Agents allow member choice by default unless the author
  // explicitly fixes the model. Both overrides live in the dedicated per-
  // (workspace, user) settings row and never mutate shared Agent config.
  if (deps.workspaceId) {
    try {
      const workspaceUserSettings = new WorkspaceUserSettingsModel(
        deps.db,
        deps.userId,
        deps.workspaceId,
      );
      const preference = await workspaceUserSettings.getPreference();
      memberDeviceOverride = preference.agentDeviceOverrides?.[resolvedAgentId];
      memberModelOverride = preference.agentModelOverrides?.[resolvedAgentId];
      memberModeOverride = preference.agentModeOverrides?.[resolvedAgentId];
    } catch (error) {
      // Losing preferences is non-fatal: execution falls back to the shared
      // Agent row.
      log('execAgent: failed to load caller workspace_user_settings preferences: %O', error);
    }
  }

  let canManageAgent = agentConfig.userId === deps.userId;
  const agentWorkspaceId = agentConfig.workspaceId ?? deps.workspaceId;
  const isPublicWorkspaceAgent = !!agentWorkspaceId && agentConfig.visibility !== 'private';
  if (isPublicWorkspaceAgent && !canManageAgent) {
    try {
      // Author-or-admin, NOT the configuration flag: this value decides whether
      // the run ignores the member's own model / device / mode overrides, and a
      // collaborative builtin must keep honoring them — the client runtime
      // (`agentConfigResolver`) resolves the same distinction from authorship.
      canManageAgent = await isResourceAuthorOrAdmin({
        db: deps.db,
        meta: {
          userId: agentConfig.userId,
          visibility: agentConfig.visibility ?? 'public',
          workspaceId: agentWorkspaceId,
        },
        resourceType: 'agent',
        userId: deps.userId,
        workspaceId: agentWorkspaceId,
      });
    } catch (error) {
      // Permission lookup failure is fail-closed: applying member policy is
      // safer than accidentally granting shared-config semantics.
      log('execAgent: failed to resolve Agent management access: %O', error);
    }
  }

  agentConfig.agencyConfig = resolveAgentAgencyConfig(
    agentConfig.agencyConfig,
    memberDeviceOverride,
    {
      canManage: canManageAgent,
      visibility: agentConfig.visibility,
      workspaceId: agentWorkspaceId,
    },
  );
  if (!canManageAgent && memberModeOverride !== undefined) {
    agentConfig.chatConfig = {
      ...agentConfig.chatConfig,
      enableAgentMode: memberModeOverride,
    };
  }

  // callSubAgent thinking / reasoning-effort overrides. A virtual sub-agent
  // executes the same agent row, so `agentConfig.chatConfig` here IS the
  // parent's chatConfig — merging the `agencyConfig.subagent.chatConfig`
  // patch over it yields the sub-agent's effective config.
  if (chatConfigOverride) {
    agentConfig.chatConfig =
      resolveSubAgentChatConfig(agentConfig.chatConfig, chatConfigOverride) ??
      agentConfig.chatConfig;
    // Keep the raw override so the LLM context hints can re-apply explicit
    // sub-agent reasoning choices over the user's model-instance defaults —
    // the merged chatConfig alone can't distinguish them from stale agent
    // values, which the reasoning-config migration ignores.
    agentConfig.subAgentChatConfigOverride = chatConfigOverride;
  }

  // Explicit per-conversation mode switch (IM `/mode` command). Applied last
  // so it wins over the agent's own chatConfig, workspace member-mode
  // overrides, and sub-agent chatConfig patches alike. `enableAgentMode` is
  // kept in sync because the context engine gates agentic-only injectors
  // (skill discovery, agent documents, agent-management context) on it, not
  // on `toolMode` — otherwise `/mode chat` would keep agentic context while
  // `/mode agent` on a chat-default agent would run tools without it.
  if (toolModeOverride) {
    // `custom` is agent-side (the `/mode` picker reports it as Agent Mode)
    // but means "exactly the agent's declared plugins". Returning to Agent
    // Mode must restore that hand-picked set, not widen it to the full
    // default toolset by overwriting `custom` with `agent`.
    const storedToolMode = agentConfig.chatConfig?.toolMode;
    agentConfig.chatConfig = {
      ...agentConfig.chatConfig,
      enableAgentMode: toolModeOverride === 'agent',
      toolMode:
        toolModeOverride === 'agent' && storedToolMode === 'custom' ? 'custom' : toolModeOverride,
    };
  }

  // Persistence-attribution agent id. Background Agent Signal runs (memory /
  // skill / self-reflection) execute under a builtin slug, so `resolvedAgentId`
  // is the builtin agent — but the run's persisted messages, like its operation
  // row (createOperation appContext.agentId) and receipts, must attribute to the
  // reviewed *user* agent carried on `marker.agentId`. Ordinary runs (no marker)
  // fall back to the executing agent. Tools / systemRole / skills / agent
  // documents stay keyed on `resolvedAgentId`.
  const persistAgentId = appContext?.agentSignal?.agentId ?? resolvedAgentId;
  const conversationAgentId = appContext?.conversationAgentId ?? persistAgentId;
  const assistantAgentId = appContext?.conversationAgentId ? resolvedAgentId : persistAgentId;

  // Resolve the final model once, keeping per-call task / sub-agent overrides
  // above the caller's personal workspace choice and the shared Agent default.
  // The callSubAgent spawn site resolves the sub-agent default and passes it
  // explicitly, so this path never has to special-case sub-agents.
  const effectiveModel = resolveAgentModelConfig(
    {
      ...agentConfig,
      canManage: canManageAgent,
      // A collaborative builtin is Workspace infrastructure with no author and
      // no config page, so its model is personal for every caller — being its
      // creator or an admin must not pin the whole Workspace to one model.
      // Device / mode overrides keep the ordinary author rule above.
      personalModelSelection: isCollaborativeBuiltinAgentRow({
        ...agentConfig,
        workspaceId: agentWorkspaceId,
      }),
      workspaceId: agentWorkspaceId,
    },
    memberModelOverride,
    {
      ...(modelOverride ? { model: modelOverride } : {}),
      ...(providerOverride ? { provider: providerOverride } : {}),
    },
  );
  agentConfig.model = effectiveModel.model;
  agentConfig.provider = effectiveModel.provider;

  log(
    'execAgent: got agent config for %s (id: %s), model: %s, provider: %s',
    identifier,
    resolvedAgentId,
    agentConfig.model,
    agentConfig.provider,
  );

  // Capture disabled identifiers before collapsing to pinned-only ids below
  // — everything from here on (builtin runtime merge, page/task/sub-agent
  // injection, the `agentPlugins` build further down) expects a plain
  // pinned-id string[], matching pre-tri-state behavior. Operating on a
  // local `string[]` (rather than repeatedly re-reading/writing
  // `agentConfig.plugins`, whose declared type is the wider
  // `AgentPluginEntry[]`) keeps this whole block free of per-line casts;
  // `agentConfig.plugins` is written back once, at the end.
  // `disabledPluginIds` is consumed later to filter the auto-discovery
  // candidate pool (installedPlugins) so disabled plugins can't be
  // rediscovered/activated by the auto activator.
  const disabledPluginIds = getDisabledPluginIds(agentConfig.plugins);
  let activePluginIds: string[] = getActivePluginIds(agentConfig.plugins);

  // 2. Merge builtin agent runtime config (systemRole, plugins)
  // The DB only stores persist config. Runtime config (e.g. inbox systemRole) is generated dynamically.
  const agentSlug = agentConfig.slug;
  const builtinSlugs = Object.values(BUILTIN_AGENT_SLUGS) as string[];
  if (agentSlug && builtinSlugs.includes(agentSlug)) {
    let userLocale: string | undefined;
    try {
      const userInfo = await UserModel.getInfoForAIGeneration(deps.db, deps.userId);
      userLocale = userInfo.responseLanguage;
    } catch (error) {
      log('execAgent: failed to load user locale for builtin runtime config: %O', error);
    }

    const runtimeConfig = getAgentRuntimeConfig(agentSlug, {
      model: agentConfig.model,
      plugins: activePluginIds,
      userLocale,
    });
    if (runtimeConfig) {
      // Runtime systemRole takes effect only if DB has no user-customized systemRole
      if (!agentConfig.systemRole && runtimeConfig.systemRole) {
        agentConfig.systemRole = runtimeConfig.systemRole;
        log('execAgent: merged builtin agent runtime systemRole for slug=%s', agentSlug);
      }
      // Runtime plugins merged (runtime plugins take priority if provided)
      if (runtimeConfig.plugins && runtimeConfig.plugins.length > 0) {
        activePluginIds = runtimeConfig.plugins;
        log('execAgent: merged builtin agent runtime plugins for slug=%s', agentSlug);
      }
      if (runtimeConfig.agencyConfig) {
        agentConfig.agencyConfig = {
          ...agentConfig.agencyConfig,
          ...runtimeConfig.agencyConfig,
        };
        log('execAgent: merged builtin agent runtime agencyConfig for slug=%s', agentSlug);
      }
    }
  }

  if (appContext?.scope !== 'page') {
    activePluginIds = activePluginIds.filter((id) => id !== PageAgentIdentifier);
  }

  if (appContext?.scope === 'page' && agentSlug !== BUILTIN_AGENT_SLUGS.pageAgent) {
    const pageAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.pageAgent, {
      model: agentConfig.model,
      plugins: activePluginIds,
    });
    const pageAgentSystemRole = pageAgentRuntime?.systemRole || '';

    if (pageAgentSystemRole) {
      agentConfig.systemRole = agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${pageAgentSystemRole}`
        : pageAgentSystemRole;
    }

    activePluginIds = activePluginIds.includes(PageAgentIdentifier)
      ? activePluginIds
      : [PageAgentIdentifier, ...activePluginIds];
    agentConfig.chatConfig = {
      ...agentConfig.chatConfig,
      enableHistoryCount: false,
    };
    log('execAgent: injected page-agent runtime for page scope');
  }

  if (appContext?.scope === 'task' && agentSlug !== BUILTIN_AGENT_SLUGS.taskAgent) {
    const taskAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.taskAgent, {
      model: agentConfig.model,
      plugins: activePluginIds,
    });
    const taskAgentSystemRole = taskAgentRuntime?.systemRole || '';

    if (taskAgentSystemRole) {
      agentConfig.systemRole = agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${taskAgentSystemRole}`
        : taskAgentSystemRole;
    }

    activePluginIds = activePluginIds.includes(TaskIdentifier)
      ? activePluginIds
      : [TaskIdentifier, ...activePluginIds];
    log('execAgent: injected task-agent runtime for task scope');
  }

  if (appContext?.isSubAgent) {
    activePluginIds = activePluginIds.filter((id) => id !== LobeAgentIdentifier);
  }

  agentConfig.plugins = activePluginIds;

  await throwIfExecutionAborted('agent configuration');

  // 2.5. Append additional instructions to agent's systemRole
  if (instructions) {
    agentConfig.systemRole = agentConfig.systemRole
      ? `${agentConfig.systemRole}\n\n${instructions}`
      : instructions;
    log('execAgent: appended additional instructions to systemRole');
  }

  return {
    agentConfig,
    agentSlug,
    assistantAgentId,
    canManageAgent,
    conversationAgentId,
    disabledPluginIds,
    isPublicWorkspaceAgent,
    memberDeviceOverride,
    persistAgentId,
    resolvedAgentId,
  };
};
