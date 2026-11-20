import { getUserDisabledToolIds, isOnDemandBuiltinTool } from '@lobechat/builtin-tools';
import { resolveSubAgentChatConfig } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { type AgentConfigSnapshot, resolveAgentConfig } from '@lobechat/mecha';
import type {
  AgentModelOverride,
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  MessageMapScope,
} from '@lobechat/types';
import {
  applyTopicModelToHeterogeneousProvider,
  getAutoPluginIds,
  getPinnedPluginIds,
  resolveAgentAgencyConfig,
  resolveHeterogeneousModelOverride,
} from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import type { AgentConfigWithId } from '@/server/services/agent';
import { isResourceAuthorOrAdmin } from '@/server/services/resourcePermission';
import { isSandboxAvailableForUser } from '@/server/services/sandbox/availability';

import type { InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface ResolveRunAgentConfigDeps {
  db: LobeChatDatabase;
  resolveAgentConfigOrThrow: (identifier: string) => Promise<AgentConfigWithId>;
  userId: string;
  workspaceId?: string;
}

export interface ResolveRunAgentConfigInput {
  agentConfigSnapshot?: InternalExecAgentParams['agentConfigSnapshot'];
  appContext?: InternalExecAgentParams['appContext'];
  chatConfigOverride?: InternalExecAgentParams['chatConfigOverride'];
  /** Agent id or slug (agentId takes precedence at the call site). */
  identifier: string;
  instructions?: string;
  modelOverride?: string;
  providerOverride?: string;
  /**
   * The share visitor actually driving a shared-agent run. The service is
   * constructed as the share owner, so caller-scoped facts (the reply
   * language appended to the system role) must be read for this user instead.
   */
  shareVisitorUserId?: string;
  snapshotFollowsCallerDevice?: InternalExecAgentParams['snapshotFollowsCallerDevice'];
  throwIfExecutionAborted: (stage: string) => Promise<void>;
  toolModeOverride?: InternalExecAgentParams['toolModeOverride'];
}

// The IM /mode switch controls both the toolset and agentic context injection.
// Returning to Agent mode keeps an explicitly custom toolset instead of widening it.
const withConversationMode = (
  config: LobeAgentChatConfig,
  mode: NonNullable<ResolveRunAgentConfigInput['toolModeOverride']>,
): LobeAgentChatConfig => ({
  ...config,
  enableAgentMode: mode === 'agent',
  toolMode: mode === 'agent' && config?.toolMode === 'custom' ? 'custom' : mode,
});

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
  /** Library skills the agent set to `auto`, captured before pinned-id collapse. */
  autoSkillIds: string[];
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

export interface WorkspaceMemberOverrides {
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
export const loadWorkspaceMemberOverrides = async (
  deps: Pick<ResolveRunAgentConfigDeps, 'db' | 'userId' | 'workspaceId'>,
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
export const resolveCanManage = async (
  deps: Pick<ResolveRunAgentConfigDeps, 'db' | 'userId'>,
  agentConfig: Pick<AgentConfigWithId, 'userId' | 'visibility'>,
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

const loadUserLocale = async (
  deps: ResolveRunAgentConfigDeps,
  userId: string,
): Promise<string | undefined> => {
  try {
    const userInfo = await UserModel.getInfoForAIGeneration(deps.db, userId);
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
    shareVisitorUserId,
    throwIfExecutionAborted,
    toolModeOverride,
  } = input;

  // --- gather the snapshot ---
  const current = await deps.resolveAgentConfigOrThrow(identifier);
  // Keep current identity/access metadata, but use the settings the dispatcher claimed.
  const row = input.agentConfigSnapshot
    ? {
        ...current,
        ...structuredClone(input.agentConfigSnapshot),
        id: current.id,
        userId: current.userId,
        workspaceId: current.workspaceId,
        visibility: current.visibility,
      }
    : current;
  const resolvedAgentId = row.id;
  const agentWorkspaceId = row.workspaceId ?? deps.workspaceId;
  const isPublicWorkspaceAgent = !!agentWorkspaceId && row.visibility !== 'private';

  const scope = (appContext?.scope ?? undefined) as MessageMapScope | undefined;
  const [overrides, canManageAgent, userLocale, pageSandboxAvailable] = await Promise.all([
    input.agentConfigSnapshot
      ? // The snapshot decided model and mode; only the caller's device may still follow them.
        input.snapshotFollowsCallerDevice
        ? loadWorkspaceMemberOverrides(deps, resolvedAgentId).then(
            ({ device }): WorkspaceMemberOverrides => ({ device }),
          )
        : Promise.resolve({} as WorkspaceMemberOverrides)
      : loadWorkspaceMemberOverrides(deps, resolvedAgentId),
    resolveCanManage(deps, row, agentWorkspaceId, isPublicWorkspaceAgent),
    // A share visitor replies in their own language, not the owner's.
    loadUserLocale(deps, shareVisitorUserId ?? deps.userId),
    // The page agent edits through the sandbox; without one it would only fail.
    scope === 'page' ? isSandboxAvailableForUser(deps.db, deps.userId) : true,
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
    // The shared resolver filters saved pins before composing runtime tools.
    // Give it the conversation's mode now; filtered pins cannot be recovered later.
    chatConfig: toolModeOverride
      ? withConversationMode(
          resolveSubAgentChatConfig(row.chatConfig, chatConfigOverride) ?? row.chatConfig,
          toolModeOverride,
        )
      : row.chatConfig,
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
      pageAgentUnavailable: !pageSandboxAvailable,
      scope,
    },
    snapshot,
  );

  // Capture disabled identifiers off the row before the resolved config
  // collapses plugins to pinned ids: they later filter the auto-discovery
  // candidate pool so a disabled plugin can't be rediscovered.
  const disabledPluginIds = getUserDisabledToolIds(row.plugins, resolved.chatConfig);
  // Same for the explicit `auto` entries: a library skill is opt-in per agent,
  // so the skill pool needs the ones this agent opted into without pinning.
  const autoSkillIds = [
    ...getAutoPluginIds(row.plugins),
    ...getPinnedPluginIds(row.plugins).filter(isOnDemandBuiltinTool),
  ];

  // One mutable object from here on — later stages append to `systemRole` and
  // `createOperation` must see those writes.
  const agentConfig: AgentConfigWithId = Object.assign(row, resolved.agentConfig, {
    chatConfig: resolved.chatConfig,
    plugins: resolved.plugins,
  });

  // Task overrides must reach the external runtime before topic snapshotting.
  // Updating only agentConfig.model leaves the CLI using the assignee's model.
  // An Agent-row wrapper snapshot (a runtime ID such as `codex/openai`, or an
  // ordinary chat model) is not a CLI model; applying it would force `--model`
  // or rewrite an API binding, so only a runtime-compatible pair applies.
  const heterogeneousProvider = agentConfig.agencyConfig?.heterogeneousProvider;
  const heterogeneousModelOverride =
    heterogeneousProvider && modelOverride
      ? resolveHeterogeneousModelOverride(heterogeneousProvider, {
          model: modelOverride,
          provider: providerOverride,
        })
      : undefined;
  if (heterogeneousProvider && heterogeneousModelOverride) {
    agentConfig.agencyConfig = {
      ...agentConfig.agencyConfig,
      heterogeneousProvider: applyTopicModelToHeterogeneousProvider(
        heterogeneousProvider,
        heterogeneousModelOverride,
      ),
    };
  }

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

  // Builtin and sub-agent patches can also declare a mode. The conversation
  // switch wins for the final context just as it does for saved pin selection.
  if (toolModeOverride)
    agentConfig.chatConfig = withConversationMode(agentConfig.chatConfig, toolModeOverride);

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
    autoSkillIds,
    canManageAgent,
    conversationAgentId,
    disabledPluginIds,
    isPublicWorkspaceAgent,
    memberDeviceOverride: overrides.device,
    persistAgentId,
    resolvedAgentId,
  };
};
