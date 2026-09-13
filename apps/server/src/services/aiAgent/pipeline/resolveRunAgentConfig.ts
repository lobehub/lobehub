import { resolveSubAgentChatConfig } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { type AgentConfigSnapshot, resolveAgentConfig } from '@lobechat/mecha';
import type { AgentModelOverride, LobeAgentAgencyConfig, MessageMapScope } from '@lobechat/types';
import { getDisabledPluginIds, resolveAgentAgencyConfig } from '@lobechat/types';
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

interface WorkspaceMemberOverrides {
  device?: Pick<LobeAgentAgencyConfig, 'boundDeviceId' | 'executionTarget'>;
  mode?: boolean;
  model?: AgentModelOverride;
}

/**
 * This caller's workspace-scoped execution / model / mode preferences for the
 * agent. They live in the dedicated per-(workspace, user) settings row and
 * never mutate the shared Agent config. Losing them is non-fatal: execution
 * falls back to the shared row.
 */
const loadWorkspaceMemberOverrides = async (
  deps: ResolveRunAgentConfigDeps,
  agentId: string,
): Promise<WorkspaceMemberOverrides> => {
  if (!deps.workspaceId) return {};
  try {
    const preference = await new WorkspaceUserSettingsModel(
      deps.db,
      deps.userId,
      deps.workspaceId,
    ).getPreference();
    return {
      device: preference.agentDeviceOverrides?.[agentId],
      mode: preference.agentModeOverrides?.[agentId],
      model: preference.agentModelOverrides?.[agentId],
    };
  } catch (error) {
    log('execAgent: failed to load caller workspace_user_settings preferences: %O', error);
    return {};
  }
};

/**
 * Author-or-admin, NOT the configuration flag: this value decides whether the
 * run ignores the member's own model / device / mode overrides, and a
 * collaborative builtin must keep honoring them — the client runtime resolves
 * the same distinction from authorship. Permission lookup failure is
 * fail-closed: applying member policy is safer than accidentally granting
 * shared-config semantics.
 */
const resolveCanManage = async (
  deps: ResolveRunAgentConfigDeps,
  agentConfig: AgentConfigWithId,
  agentWorkspaceId: string | undefined,
  isPublicWorkspaceAgent: boolean,
): Promise<boolean> => {
  if (agentConfig.userId === deps.userId) return true;
  if (!isPublicWorkspaceAgent || !agentWorkspaceId) return false;
  try {
    return await isResourceAuthorOrAdmin({
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
    log('execAgent: failed to resolve Agent management access: %O', error);
    return false;
  }
};

const loadUserLocale = async (deps: ResolveRunAgentConfigDeps): Promise<string | undefined> => {
  try {
    const userInfo = await UserModel.getInfoForAIGeneration(deps.db, deps.userId);
    return userInfo.responseLanguage;
  } catch (error) {
    log('execAgent: failed to load user locale for agent config resolution: %O', error);
    return undefined;
  }
};

/**
 * Stages 1–2.5 of {@link AiAgentService.execAgent}: resolve the effective agent
 * configuration for this run.
 *
 * Gathers what the shared rules need from the server's own sources (the agent
 * row, the caller's workspace member overrides, author-or-admin access, the
 * user's reply language), runs `resolveAgentConfig` from `@lobechat/mecha` —
 * the same rules the client runtime applies — and then layers the per-call
 * intents only a run knows about: the member device override, callSubAgent
 * chatConfig patches, the IM `/mode` override, the persistence-attribution
 * agent ids and the per-call `instructions` systemRole append.
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

  // --- gather the snapshot ---
  const row = await deps.resolveAgentConfigOrThrow(identifier);
  const resolvedAgentId = row.id;
  const agentWorkspaceId = row.workspaceId ?? deps.workspaceId;
  const isPublicWorkspaceAgent = !!agentWorkspaceId && row.visibility !== 'private';

  const [overrides, canManageAgent, userLocale] = await Promise.all([
    loadWorkspaceMemberOverrides(deps, resolvedAgentId),
    resolveCanManage(deps, row, agentWorkspaceId, isPublicWorkspaceAgent),
    loadUserLocale(deps),
  ]);

  // The caller's device preference layers onto the shared row BEFORE the
  // shared rules run, so a builtin runtime that pins its own execution target
  // (the onboarding agents set `executionTarget: 'none'`) still wins over a
  // saved member override when its `agencyConfig` is merged on top.
  row.agencyConfig = resolveAgentAgencyConfig(row.agencyConfig, overrides.device, {
    canManage: canManageAgent,
    visibility: row.visibility,
    workspaceId: agentWorkspaceId,
  });

  const snapshot: AgentConfigSnapshot = {
    agent: {
      name: row.name ?? null,
      slug: row.slug,
      title: row.title ?? null,
      userId: row.userId,
      virtual: (row as { virtual?: boolean | null }).virtual,
      visibility: row.visibility,
      workspaceId: agentWorkspaceId ?? null,
    },
    agentConfig: row,
    canManage: canManageAgent,
    chatConfig: row.chatConfig,
    memberModeOverride: overrides.mode,
    memberModelOverride: overrides.model,
    slug: row.slug ?? undefined,
    userLocale,
  };

  // --- shared rules ---
  const resolved = resolveAgentConfig(
    {
      agentId: resolvedAgentId,
      groupId: appContext?.groupId ?? undefined,
      isSubAgent: appContext?.isSubAgent,
      modelOverride: {
        ...(modelOverride ? { model: modelOverride } : {}),
        ...(providerOverride ? { provider: providerOverride } : {}),
      },
      scope: (appContext?.scope ?? undefined) as MessageMapScope | undefined,
    },
    snapshot,
  );

  // Capture disabled identifiers off the row before the resolved config
  // collapses plugins to pinned ids: they later filter the auto-discovery
  // candidate pool so a disabled plugin can't be rediscovered.
  const disabledPluginIds = getDisabledPluginIds(row.plugins);

  // One mutable object from here on — later stages append to `systemRole` and
  // `createOperation` must see those writes.
  const agentConfig: AgentConfigWithId = Object.assign(row, resolved.agentConfig, {
    chatConfig: resolved.chatConfig,
    plugins: resolved.plugins,
  });

  // --- per-call intents the shared rules do not know ---
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

  log(
    'execAgent: got agent config for %s (id: %s), model: %s, provider: %s',
    identifier,
    resolvedAgentId,
    agentConfig.model,
    agentConfig.provider,
  );

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
    agentSlug: row.slug,
    assistantAgentId,
    canManageAgent,
    conversationAgentId,
    disabledPluginIds,
    isPublicWorkspaceAgent,
    memberDeviceOverride: overrides.device,
    persistAgentId,
    resolvedAgentId,
  };
};
