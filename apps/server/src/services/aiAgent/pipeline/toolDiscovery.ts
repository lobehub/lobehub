import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { GoalIdentifier, isGoalPrompt } from '@lobechat/builtin-tool-goal';
import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import type { DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import { generateSystemPrompt, RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import {
  injectSelfFeedbackIntentTool,
  shouldExposeSelfFeedbackIntentTool,
} from '@lobechat/builtin-tool-self-iteration';
import { manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import type {
  AgentGroupConfig,
  LobeToolManifest,
  ToolExecutor,
  ToolsEngine,
  ToolSource,
} from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatTopicBotContext, RequestTrigger } from '@lobechat/types';
import { getActivePluginIds } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import type { ModelAbilities } from 'model-bank';

import type { loadModels } from '@/business/client/model-bank/loadModels';
import { AiModelModel } from '@/database/models/aiModel';
import { AiProviderModel } from '@/database/models/aiProvider';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { FileModel } from '@/database/models/file';
import type { MessageModel } from '@/database/models/message';
import type { PluginModel } from '@/database/models/plugin';
import {
  type ExecutionPlan,
  executionPlanToManifestExecutionEnv,
  executionTargetToRuntimeMode,
  isDeviceCapablePlan,
  isDeviceLockedPlan,
  resolveExecutionPlan,
  resolveToolMode,
} from '@/helpers/executionTarget';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { patchManifestWithPermissions } from '@/libs/mcp/connectorPermissionCheck';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type { ServerAgentToolsContext } from '@/server/modules/Mecha';
import { createServerAgentToolsEngine } from '@/server/modules/Mecha';
import type { AgentDocumentsService } from '@/server/services/agentDocuments';
import {
  isAgentSignalEnabledForUser,
  isLobeAiAgentSlug,
  resolveAgentSelfIterationCapability,
} from '@/server/services/agentSignal/featureGate';
import { platformRegistry } from '@/server/services/bot/platforms';
import type { ComposioService } from '@/server/services/composio';
import {
  buildLastSyncedAtMap,
  scheduleStaleConnectorToolsRefresh,
} from '@/server/services/connector/refresh';
import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';
import type { MarketService } from '@/server/services/market';
import {
  buildConnectorOwnershipPrompt,
  collectBorrowedConnectors,
  resolveUserDisplayMap,
} from '@/server/utils/connectorAttribution';

import {
  buildAllowedBuiltinTools,
  isDeviceToolIdentifier,
  REMOTE_DEVICE_TOOL_IDENTIFIERS,
} from '../deviceToolRegistry';
import { buildBotConversationGroupContext, buildGroupAgentContext } from '../helpers/groupContext';
import {
  getMediaAvailabilityFromFileTypes,
  getMediaAvailabilityFromMessages,
  isMultimodalUnderstandingConfigured,
} from '../helpers/mediaAvailability';
import { resolveServerSearchDecision } from '../searchDecision';
import type { ExecRunContext, InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface ToolDiscoveryDeps {
  agentDocumentsService: AgentDocumentsService;
  composioService: ComposioService;
  connectorModel: ConnectorModel;
  connectorToolModel: ConnectorToolModel;
  db: LobeChatDatabase;
  getMarketService: () => Promise<MarketService>;
  messageModel: MessageModel;
  pluginModel: PluginModel;
  userId: string;
  workspaceId?: string;
}

export interface ToolDiscoveryInput {
  additionalPluginIds?: string[];
  agentSlug?: string | null;
  attachedFileIds?: string[];
  botContext?: ChatTopicBotContext;
  /** Tri-state disabled plugin identifiers captured before pinned-id collapse. */
  disabledPluginIds: string[];
  disableLocalSystem?: boolean;
  disableSelfFeedbackIntentTool?: boolean;
  disableTools?: boolean;
  discordContext?: any;
  exclusivePluginIds?: string[];
  files?: InternalExecAgentParams['files'];
  functionTools?: InternalExecAgentParams['functionTools'];
  globalMemoryEnabled: boolean;
  hasMentionedAgents: boolean;
  isFixedDeviceTarget: boolean;
  /** Shared lazy history loader — also consumed by the caller after discovery. */
  loadHistoryMessages: () => Promise<any[]>;
  localDeviceId?: string;
  requestedDeviceId?: string;
  requestTrigger?: RequestTrigger;
  selectedToolIds?: string[];
  throwIfExecutionAborted: (stage: string) => Promise<void>;
  topicBoundDeviceId?: string | null;
}

export interface ToolDiscoveryResult {
  activeDeviceId?: string;
  activeDeviceScope?: 'personal' | 'workspace';
  agentPlugins: string[];
  builtinModels: Awaited<ReturnType<typeof loadModels>>;
  composioManifests: LobeToolManifest[];
  connectorManifests: ReturnType<typeof buildConnectorManifests>;
  executionPlan?: ExecutionPlan;
  hasAgentDocuments: boolean;
  hasEnabledKnowledgeBases: boolean;
  lobehubSkillManifests: LobeToolManifest[];
  onlineDevices: DeviceAttachment[];
  operationAgentGroup?: AgentGroupConfig;
  searchDecision: ReturnType<typeof resolveServerSearchDecision>;
  toolExecutorMap: Record<string, ToolExecutor>;
  toolManifestMap: Record<string, any>;
  tools?: any[];
  toolsEngine?: ToolsEngine;
  toolSourceMap: Record<string, ToolSource>;
  toolsResult: { enabledToolIds: string[]; tools?: any[] | undefined };
}

/**
 * Stage 5 (5a–5f) of {@link AiAgentService.execAgent}: tool discovery.
 *
 * Resolves the full tool surface for the run — installed plugins, connectors
 * (real-MCP replacement + permission patching), LobeHub Skills, Composio
 * manifests, device pool + execution plan, group-orchestration authorization,
 * the tools-engine invocation pool, and the activator-discoverable manifest
 * map — plus the Response-API client function tools and the RemoteDevice
 * systemRole override.
 *
 * Short-circuits when `disableTools` is set (only the client function tools
 * are honored), matching the pre-extraction behavior.
 *
 * Side effect: appends to `ctx.agentConfig.systemRole` (connector credential
 * ownership note) — `createOperation` downstream must see that write.
 */
export const discoverTools = async (
  deps: ToolDiscoveryDeps,
  ctx: ExecRunContext,
  input: ToolDiscoveryInput,
): Promise<ToolDiscoveryResult> => {
  const {
    agentConfig,
    appContext,
    assistantMessageId,
    canUseDevice,
    model,
    prompt,
    provider,
    resolvedAgentId,
    topicId,
  } = ctx;
  const {
    additionalPluginIds,
    agentSlug,
    attachedFileIds,
    botContext,
    disableLocalSystem,
    disableSelfFeedbackIntentTool,
    disableTools,
    disabledPluginIds,
    discordContext,
    exclusivePluginIds,
    files,
    functionTools,
    globalMemoryEnabled,
    hasMentionedAgents,
    isFixedDeviceTarget,
    loadHistoryMessages,
    localDeviceId,
    requestTrigger,
    requestedDeviceId,
    selectedToolIds,
    throwIfExecutionAborted,
    topicBoundDeviceId,
  } = input;

  let tools: any[] | undefined;
  let toolsResult: { enabledToolIds: string[]; tools?: any[] | undefined } = {
    enabledToolIds: [],
    tools: undefined,
  };
  let toolsEngine: ToolsEngine | undefined;
  const toolManifestMap: Record<string, any> = {};
  const toolSourceMap: Record<string, ToolSource> = {};
  const toolExecutorMap: Record<string, ToolExecutor> = {};
  let onlineDevices: DeviceAttachment[] = [];
  let activeDeviceId: string | undefined;
  let activeDeviceScope: 'personal' | 'workspace' | undefined;
  let executionPlan: ExecutionPlan | undefined;
  let hasAgentDocuments = false;
  let hasEnabledKnowledgeBases = false;
  let operationAgentGroup: AgentGroupConfig | undefined;
  const isBotConversation = !!(botContext || discordContext);

  // Device-tool access (`canUseDevice` / `deviceAccessReason`) was resolved
  // once before the hetero early exit; the decision flows into the
  // engine's enable gates (LocalSystem / RemoteDevice) and the RemoteDevice
  // systemRole injection below.

  // These are needed outside the tools block (for agent management context, skill engine, etc.)
  let lobehubSkillManifests: LobeToolManifest[] = [];
  let composioManifests: LobeToolManifest[] = [];
  let connectorManifests: ReturnType<typeof buildConnectorManifests> = [];

  // `selectedToolIds` are the user's @-mention picks for this turn; merged in
  // (deduped) alongside the agent's pinned plugins and any internal
  // `additionalPluginIds` so a mentioned-but-not-pinned tool (e.g. a custom MCP
  // connector) is both queried for manifests and enabled by the tools engine.
  const isGoalTurn = isGoalPrompt(prompt);
  let agentPlugins: string[] = exclusivePluginIds
    ? [...new Set(exclusivePluginIds)]
    : isGoalTurn
      ? [GoalIdentifier]
      : [
          ...new Set([
            ...getActivePluginIds(agentConfig?.plugins),
            ...(additionalPluginIds || []),
            ...(selectedToolIds || []),
            ...(hasMentionedAgents ? ['lobe-agent-management'] : []),
          ]),
        ];

  // Model metadata is needed both for tool support checks and agent-management context.
  const { loadModels } = await import('@/business/client/model-bank/loadModels');
  const builtinModels = await loadModels();
  const [modelMetadataResult, providerMetadataResult] = await Promise.allSettled([
    new AiModelModel(deps.db, deps.userId, deps.workspaceId).findByIdAndProvider(model, provider),
    new AiProviderModel(deps.db, deps.userId, deps.workspaceId).findById(provider),
  ]);
  if (modelMetadataResult.status === 'rejected') {
    log('execAgent: failed to load active model search metadata: %O', modelMetadataResult.reason);
  }
  if (providerMetadataResult.status === 'rejected') {
    log(
      'execAgent: failed to load active provider search metadata: %O',
      providerMetadataResult.reason,
    );
  }
  const activeModelMetadata =
    modelMetadataResult.status === 'fulfilled' ? modelMetadataResult.value : undefined;
  const activeProviderMetadata =
    providerMetadataResult.status === 'fulfilled' ? providerMetadataResult.value : undefined;
  const activeModelAbilities = activeModelMetadata?.abilities as ModelAbilities | undefined;
  const searchDecision = resolveServerSearchDecision({
    builtinModels,
    chatConfig: agentConfig.chatConfig ?? undefined,
    hasModelAbilitiesOverride:
      !!activeModelAbilities && Object.keys(activeModelAbilities).length > 0,
    model,
    modelSearchAbility: activeModelAbilities?.search,
    modelSearchImpl: activeModelMetadata?.settings?.searchImpl,
    provider,
    providerSearchMode: activeProviderMetadata?.settings?.searchMode,
  });

  if (disableTools) {
    log('execAgent: tools disabled by disableTools flag, skipping all tool discovery');
  } else {
    // 5a. Get installed plugins from database. Disabled identifiers are
    // excluded from this candidate pool entirely — not just from the pinned
    // `rules` allowlist — because `createEnableChecker`'s explicit-activation
    // bypass (auto activator) short-circuits before rules are consulted, so a
    // present-but-rule-disabled manifest could still be auto-activated.
    const disabledPluginIdSet = new Set(disabledPluginIds);
    const installedPlugins = (await deps.pluginModel.query()).filter(
      (p) => !disabledPluginIdSet.has(p.identifier),
    );
    log(
      'execAgent: got %d installed plugins (%d disabled excluded)',
      installedPlugins.length,
      disabledPluginIdSet.size,
    );

    // 5a-1. Resolve connectors — connector identifier takes priority over plugin.
    // Credentials (OAuth tokens) are encrypted at rest, so decrypt them with a
    // gatekeeper; otherwise buildConnectorManifests gets no auth and tool calls 401.
    let connectorGateKeeper: KeyVaultsGateKeeper | undefined;
    try {
      connectorGateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    } catch (err) {
      log('execAgent: failed to init gatekeeper for connector credentials: %O', err);
    }
    const connectors =
      agentPlugins.length > 0
        ? await deps.connectorModel.resolveByIdentifiers(
            agentPlugins,
            resolvedAgentId,
            connectorGateKeeper,
          )
        : [];

    // 5a-1b. Model awareness: when the caller runs a shared agent whose tools
    // were authorized by OTHER members (workspace dimension), tell the model
    // whose connected account each such tool runs on. Skipped entirely when
    // the caller authorized everything (owner runs own agent → empty set), so
    // it costs nothing in the common case. Appended to `systemRole`, which is
    // consumed by `createOperation` further below.
    try {
      const borrowed = collectBorrowedConnectors(connectors, deps.userId!);
      if (borrowed.length > 0) {
        const displayMap = await resolveUserDisplayMap(
          deps.db,
          borrowed.map((b) => b.authorizerId),
        );
        const note = buildConnectorOwnershipPrompt(borrowed, displayMap);
        if (note) {
          agentConfig.systemRole = agentConfig.systemRole
            ? `${agentConfig.systemRole}\n\n${note}`
            : note;
          log(
            'execAgent: injected tool credential ownership note for %d connector(s)',
            borrowed.length,
          );
        }
      }
    } catch (err) {
      log('execAgent: failed to build tool credential ownership note: %O', err);
    }

    // Only connectors WITH a real MCP endpoint (mcpServerUrl or stdio) can replace plugins in the
    // manifest. Connectors WITHOUT an endpoint (e.g. Lobehub/Composio OAuth skills synced via
    // syncToolsFromClient) must continue using their original plugin executor path — otherwise
    // after humanIntervention approval the runtime tries to call mcpServerUrl='' and returns empty.
    const connectorsMcp = connectors.filter(
      (c) => c.mcpServerUrl || c.mcpConnectionType === 'stdio',
    );

    // Fetch ALL tools for all real-MCP connectors (including disabled tools) so that
    // buildConnectorManifests can show blocking descriptions for disabled tools.
    // The runtime hot-path still uses queryByConnectorIds (non-disabled only) elsewhere.
    const connectorTools =
      connectorsMcp.length > 0
        ? await deps.connectorToolModel.queryAllByConnectorIds(connectorsMcp.map((c) => c.id))
        : [];

    connectorManifests = buildConnectorManifests(connectorsMcp, connectorTools);

    // Auto-refresh stale connector tool lists in the background so upstream MCP
    // tool changes propagate without the user manually re-syncing — the freshness
    // the connectors migration lost from the old plugin system. Reuses the tools
    // just fetched as the last-sync marker (no extra query), HTTP-only, throttled,
    // and deferred via after() so it adds no latency to this run. Wrapped
    // defensively: it is a pure optimization and must never break the agent run.
    try {
      // The background sync decrypts stored OAuth/bearer credentials to auth
      // against the MCP server, so it needs a gatekeeper-backed model — the
      // same `connectorGateKeeper` used above. `deps.connectorModel` has none,
      // which would decrypt to null and make an authed connector 401 → error.
      const refreshConnectorModel = connectorGateKeeper
        ? new ConnectorModel(deps.db, deps.userId, deps.workspaceId, connectorGateKeeper)
        : deps.connectorModel;
      scheduleStaleConnectorToolsRefresh(connectorsMcp, buildLastSyncedAtMap(connectorTools), {
        connectorModel: refreshConnectorModel,
        connectorToolModel: deps.connectorToolModel,
      });
    } catch (err) {
      log('execAgent: failed to schedule connector tool refresh (ignored): %O', err);
    }

    // Only connectors that ACTUALLY produced a manifest (enabled + with synced
    // tools) replace a same-named plugin. Deriving the set from connectorsMcp
    // instead would let a disabled / not-yet-synced connector evict the plugin
    // while contributing no tools — leaving the runtime with nothing to call.
    const connectorIdentifierSet = new Set(connectorManifests.map((m) => m.identifier));

    // Filter out plugin entries that are now handled by real MCP connectors.
    // `let` because community-MCP plugins may be patched with connector
    // permissions below (their connector row has no endpoint, so they stay here).
    let pluginsWithoutConnectors = installedPlugins.filter(
      (p) => !connectorIdentifierSet.has(p.identifier),
    );
    log('execAgent: got %d connector manifests', connectorManifests.length);

    // 5b. Get model abilities from model-bank for function calling support check
    const isModelSupportToolUse = (m: string, p: string) => {
      const info = builtinModels.find((item) => item.id === m && item.providerId === p);
      return info?.abilities?.functionCall ?? true;
    };

    // 5c. Fetch LobeHub Skills manifests
    try {
      const marketService = await deps.getMarketService();
      lobehubSkillManifests = await marketService.getLobehubSkillManifests();
    } catch (error) {
      log('execAgent: failed to fetch lobehub skill manifests: %O', error);
    }
    log('execAgent: got %d lobehub skill manifests', lobehubSkillManifests.length);

    // 5d. Fetch Composio tool manifests from database
    try {
      composioManifests = await deps.composioService.getComposioManifests(resolvedAgentId);
    } catch (error) {
      log('execAgent: failed to fetch composio manifests: %O', error);
    }
    log('execAgent: got %d composio manifests', composioManifests.length);

    // 5d-1. Patch Lobehub/Composio manifests AND community-MCP plugin manifests
    // with connector tool permissions. This enables needs_approval (→
    // humanIntervention: 'required') and disabled (→ blocking description) for
    // any tool managed via the connector system but executed through a
    // non-connector path (Lobehub/Composio skills, community MCP plugins).
    // The 'disabled' hard-block is already enforced universally in
    // ToolExecutionService; this surfaces the permission to the model too.
    if (
      lobehubSkillManifests.length > 0 ||
      composioManifests.length > 0 ||
      pluginsWithoutConnectors.length > 0
    ) {
      try {
        const allIdentifiers = [
          ...lobehubSkillManifests.map((m) => m.identifier),
          ...composioManifests.map((m) => m.identifier),
          ...pluginsWithoutConnectors.map((p) => p.identifier),
        ];
        const connectorEntries =
          allIdentifiers.length > 0
            ? await deps.connectorModel.resolveByIdentifiers(allIdentifiers, resolvedAgentId)
            : [];

        if (connectorEntries.length > 0) {
          const toolModel = new ConnectorToolModel(deps.db, deps.userId, deps.workspaceId);
          const connectorToolsMap = new Map<string, Map<string, string>>();
          await Promise.all(
            connectorEntries.map(async (c) => {
              const tools = await toolModel.queryByConnector(c.id);
              const perms = new Map(tools.map((t) => [t.toolName, t.permission]));
              connectorToolsMap.set(c.identifier, perms);
            }),
          );

          lobehubSkillManifests = lobehubSkillManifests.map((m) => {
            const perms = connectorToolsMap.get(m.identifier);
            return perms && perms.size > 0
              ? (patchManifestWithPermissions(m as any, perms as any) as any)
              : m;
          });

          composioManifests = composioManifests.map((m) => {
            const perms = connectorToolsMap.get(m.identifier);
            return perms && perms.size > 0
              ? (patchManifestWithPermissions(m as any, perms as any) as any)
              : m;
          });

          // Community-MCP plugins execute via the plugin path, so patch their
          // manifest in place (the connector row holds the user's permissions).
          pluginsWithoutConnectors = pluginsWithoutConnectors.map((p) => {
            const perms = connectorToolsMap.get(p.identifier);
            if (perms && perms.size > 0 && (p as any).manifest?.api) {
              return {
                ...p,
                manifest: patchManifestWithPermissions((p as any).manifest, perms as any) as any,
              };
            }
            return p;
          });
        }
      } catch (err) {
        log('execAgent: failed to patch manifests with connector permissions: %O', err);
      }
    }

    await throwIfExecutionAborted('tool discovery');

    // 5e. Create tools using Server AgentToolsEngine
    hasEnabledKnowledgeBases =
      agentConfig.knowledgeBases?.some((kb: { enabled?: boolean | null }) => kb.enabled === true) ??
      false;

    try {
      hasAgentDocuments = await deps.agentDocumentsService.hasDocuments(resolvedAgentId);
    } catch {
      // Agent documents check is non-critical
    }

    log('execAgent: isBotConversation=%s', isBotConversation);

    // Build device context for ToolsEngine enableChecker
    const gatewayConfigured = deviceGateway.isConfigured;
    const agentBoundDeviceId = agentConfig.agencyConfig?.boundDeviceId;
    const boundDeviceId = topicBoundDeviceId || agentBoundDeviceId;
    if (gatewayConfigured) {
      try {
        // Personal pool ∪ the current workspace pool, DB rows ⊕ gateway online,
        // tagged with `scope` and the user-set `friendlyName` alias (see
        // `getScopedOnlineDevices`) so the systemRole snapshot lets the model
        // tell a personal machine apart from its workspace-enrolled counterpart
        // (same physical machine under both principals). Keep only live devices:
        // downstream `onlineDeviceIds` / `deviceOnline` treat this list as the
        // online set.
        onlineDevices = (
          await getScopedOnlineDevices(deps.db, deps.userId, deps.workspaceId)
        ).filter((d) => d.online);
        // A workspace agent whose caller pinned this desktop's personal
        // deviceId via `users.preference.agentDeviceOverrides` (
        // the `local` code path in `useSelectExecutionTarget`) needs its
        // personal device to be visible in this run's device pool — otherwise
        // `resolveExecutionPlan` treats the bound device as offline and the
        // run stays unrouted. The workspace pool never includes personal
        // devices by design (`getScopedOnlineDevices` enforces the strict
        // scope), so union the specific personal device in here. The device
        // is dispatchable because the gateway routes it by
        // `(userId, deviceId)` — the caller owns it.
        if (deps.workspaceId && agentConfig.agencyConfig?.boundDeviceId) {
          const boundId = agentConfig.agencyConfig.boundDeviceId;
          const alreadyIncluded = onlineDevices.some((d) => d.deviceId === boundId);
          if (!alreadyIncluded) {
            const personalPool = await getScopedOnlineDevices(deps.db, deps.userId).catch(
              () => [] as DeviceAttachment[],
            );
            const personalMatch = personalPool.find((d) => d.deviceId === boundId && d.online);
            if (personalMatch) {
              onlineDevices = [...onlineDevices, personalMatch];
              log(
                'execAgent: augmented device pool with caller personal device %s (per-user override)',
                boundId,
              );
            }
          }
        }
        log('execAgent: found %d online device(s)', onlineDevices.length);
      } catch (error) {
        log('execAgent: failed to query device list: %O', error);
      }
    }
    const deviceOnline = onlineDevices.length > 0;

    const toolsContext: ServerAgentToolsContext = {
      installedPlugins: pluginsWithoutConnectors,
      isModelSupportToolUse,
    };

    // Dynamically inject turn-scoped builtin tools.
    const hasTopicReference = /refer_topic/.test(prompt ?? '');
    const modelAbilities =
      builtinModels.find((item) => item.id === model && item.providerId === provider)?.abilities ??
      builtinModels.find((item) => item.id === model)?.abilities;
    const externalFileTypes = files?.map((file) => file.mimeType ?? '') ?? [];
    let attachedFileTypes: string[] = [];
    if (attachedFileIds && attachedFileIds.length > 0) {
      const fileModel = new FileModel(deps.db, deps.userId, deps.workspaceId);
      const fileRecords = await fileModel.findByIds(Array.from(new Set(attachedFileIds)));
      attachedFileTypes = fileRecords.map((file) => file.fileType || '');
    }
    const inputFileTypes = [...externalFileTypes, ...attachedFileTypes];
    const inputMediaAvailability = getMediaAvailabilityFromFileTypes(inputFileTypes);
    let historyMediaAvailability = { hasAudios: false, hasImages: false, hasVideos: false };
    const multimodalUnderstandingConfigured = isMultimodalUnderstandingConfigured();

    if (
      multimodalUnderstandingConfigured &&
      ((!modelAbilities?.audio && !inputMediaAvailability.hasAudios) ||
        (!modelAbilities?.vision && !inputMediaAvailability.hasImages) ||
        (!modelAbilities?.video && !inputMediaAvailability.hasVideos))
    ) {
      historyMediaAvailability = getMediaAvailabilityFromMessages(await loadHistoryMessages());
    }

    const needsAudioUnderstanding =
      (inputMediaAvailability.hasAudios || historyMediaAvailability.hasAudios) &&
      !modelAbilities?.audio;
    const needsImageUnderstanding =
      (inputMediaAvailability.hasImages || historyMediaAvailability.hasImages) &&
      !modelAbilities?.vision;
    const needsVideoUnderstanding =
      (inputMediaAvailability.hasVideos || historyMediaAvailability.hasVideos) &&
      !modelAbilities?.video;
    const shouldEnableMultimodalUnderstanding =
      multimodalUnderstandingConfigured &&
      (needsAudioUnderstanding || needsImageUnderstanding || needsVideoUnderstanding);
    agentPlugins = [
      ...agentPlugins,
      ...(hasTopicReference ? ['lobe-topic-reference'] : []),
      ...(isBotConversation ? [MessageToolIdentifier] : []),
      ...(shouldEnableMultimodalUnderstanding ? [LobeAgentManifest.identifier] : []),
    ];

    // Resolve THE device decision for this run. All rules live in
    // `resolveExecutionPlan` (gated on `canUseDevice` first, `none`/`sandbox`
    // never route to a device, offline bindings stay unrouted, unbound runs
    // auto-activate only with exactly one device online). Without the
    // `canUseDevice` gate an external bot sender's turn would still populate
    // `state.metadata.activeDeviceId`, and `buildStepToolDelta` re-injects
    // `LocalSystemManifest` whenever activeDeviceId is set, bypassing the
    // engine's enabledToolIds exclusion — resolving the plan here closes
    // that bypass at the source.
    //
    // `clientExecutionAvailable` is `gatewayConfigured` here: a server with a
    // device gateway can tunnel a `local` target to the user's device, so the
    // unset-target default resolves to `local` there and `none` otherwise.
    //
    // Chat mode is orthogonal to `executionTarget` (the UI toggle only writes
    // `enableAgentMode`), so a default/stored `local` target would otherwise
    // resolve a device and `buildStepToolDelta` would re-inject local-system.
    // Pass `chatConfig` so the plan degrades to `none` in chat mode — the
    // chat-mode derivation lives in `resolveExecutionPlan` (`resolveToolMode`),
    // the same source of truth the tools engine uses.
    executionPlan = resolveExecutionPlan({
      agencyConfig: agentConfig.agencyConfig,
      canUseDevice,
      chatConfig: agentConfig.chatConfig ?? undefined,
      clientExecutionAvailable: gatewayConfigured,
      localDeviceId,
      onlineDeviceIds: onlineDevices.map((device) => device.deviceId),
      requestedDeviceId,
      trigger: requestTrigger,
    });
    // A fixed device target must never degrade to the cloud sandbox or a
    // different device. Persist a visible assistant error and fail the RPC
    // before tool/runtime preparation so no operation can start elsewhere.
    if (
      isFixedDeviceTarget &&
      resolveToolMode(agentConfig.chatConfig ?? undefined) !== 'chat' &&
      executionPlan.kind !== 'device'
    ) {
      const detail =
        executionPlan.kind === 'device-unrouted' && executionPlan.reason === 'bound-device-offline'
          ? 'The device fixed by this agent is offline. Ask an editor to bring it online or change the agent device policy.'
          : 'The device fixed by this agent is unavailable for this run. Ask an editor to check the agent device policy.';
      await deps.messageModel.update(assistantMessageId, {
        content: '',
        error: {
          body: { detail },
          message: 'Fixed agent device unavailable',
          type: 'ServerAgentRuntimeError',
        },
      });
      throw new TRPCError({
        cause: { data: { code: 'FixedAgentDeviceUnavailable' } },
        code: 'PRECONDITION_FAILED',
        message: detail,
      });
    }
    // Device tools (local-system / remote-device proxy) only exist in a
    // device-capable session — `none` and `sandbox` sessions must never see
    // them, not even the proxy that could activate a device mid-run.
    const deviceCapable = isDeviceCapablePlan(executionPlan);
    // Locked = routed to a device, or explicitly bound but offline. Such a
    // run has no device decision left, so the remote-device picker is
    // physically stripped below (and in the engine walls) — the model must
    // follow the user's choice, never re-list or switch machines mid-run.
    const deviceLocked = isDeviceLockedPlan(executionPlan);
    activeDeviceId = executionPlan.kind === 'device' ? executionPlan.deviceId : undefined;
    // Which principal pool the routed device lives in. A workspace run with a
    // per-user `local` override routes to the caller's PERSONAL
    // device — the union above added it from the personal pool — and the
    // device runtimes must address it via `(userId, deviceId)`, not the
    // `workspace:<id>` pool where it has no connection. Carried through
    // operation metadata into `ToolExecutionContext` and read by
    // `resolveRunWorkspaceId`.
    activeDeviceScope = activeDeviceId
      ? onlineDevices.find((d) => d.deviceId === activeDeviceId)?.scope
      : undefined;
    log(
      'execAgent: execution plan → kind=%s deviceId=%s scope=%s',
      executionPlan.kind,
      activeDeviceId ?? 'none',
      activeDeviceScope ?? 'none',
    );
    // A device-targeted run that could not be routed silently degrades exec
    // (lobe-skills runCommand/execScript) to the cloud sandbox. Surface it as
    // a structured warn — `bound-device-offline` with a requestedDeviceId is
    // the desktop "local device" pick whose gateway connection dropped, and
    // this log is the breadcrumb for diagnosing WHY the device was judged
    // offline (lazy WS connect vs getScopedOnlineDevices failing silently).
    if (executionPlan.kind === 'device-unrouted') {
      console.warn('[AiAgentService] device-unrouted: exec degrades to cloud sandbox', {
        boundDeviceId,
        onlineDeviceCount: onlineDevices.length,
        reason: executionPlan.reason,
        requestedDeviceId,
        topicId,
        userId: deps.userId,
      });
    }

    // Resolve the operation's group context ONCE here and snapshot it into op
    // metadata below — the per-step context engine reads it back without a DB
    // lookup, mirroring agentConfig/botContext. The same roster fetch also
    // authorizes the group-orchestration toolset.
    let isGroupSupervisor = false;
    if (appContext?.groupId) {
      const chatGroupModel = new ChatGroupModel(deps.db, deps.userId, deps.workspaceId);
      const [group, roster] = await Promise.all([
        chatGroupModel.findById(appContext.groupId),
        chatGroupModel.getGroupAgentsWithMeta(appContext.groupId),
      ]);

      // `appContext.orchestrationRole` is client-supplied (execGroupAgent stamps
      // it for whatever agentId the caller passed), so it must NOT alone
      // authorize the group-orchestration toolset — otherwise any run marked
      // `{ orchestrationRole: 'supervisor', groupId }` could dispatch members.
      // Verify against the persisted, ownership-scoped membership instead.
      if (appContext.orchestrationRole === 'supervisor') {
        isGroupSupervisor = roster.some(
          (member) => member.agentId === resolvedAgentId && member.role === 'supervisor',
        );
        if (!isGroupSupervisor)
          log(
            'execAgent: orchestrationRole=supervisor but agent %s is not the supervisor of group %s — denying group tools',
            resolvedAgentId,
            appContext.groupId,
          );
      }

      operationAgentGroup = buildGroupAgentContext(resolvedAgentId, group, roster);
    } else if (botContext) {
      operationAgentGroup = buildBotConversationGroupContext(resolvedAgentId, agentConfig);
    }

    // Skills/Composio/connector identifiers share the same `plugins`
    // identifier space as installed plugins, so a disabled entry must be
    // excluded from their manifests too — otherwise the disabled tool stays
    // discoverable/activatable via these additionalManifests even though
    // `installedPlugins` above already dropped it.
    const dropDisabledManifests = <T extends { identifier: string }>(manifests: T[]): T[] =>
      disabledPluginIdSet.size === 0
        ? manifests
        : manifests.filter((m) => !disabledPluginIdSet.has(m.identifier));
    const activeLobehubSkillManifests = dropDisabledManifests(lobehubSkillManifests);
    const activeComposioManifests = dropDisabledManifests(composioManifests);
    const activeConnectorManifests = dropDisabledManifests(connectorManifests);

    toolsEngine = createServerAgentToolsEngine(toolsContext, {
      additionalManifests: [
        ...activeLobehubSkillManifests,
        ...activeComposioManifests,
        ...activeConnectorManifests,
      ],
      agentConfig: {
        chatConfig: isGoalTurn
          ? { ...agentConfig.chatConfig, toolMode: 'custom' }
          : (agentConfig.chatConfig ?? undefined),
        plugins: agentPlugins,
      },
      canUseDevice,
      deviceContext: gatewayConfigured
        ? {
            autoActivated: activeDeviceId ? true : undefined,
            boundDeviceId,
            deviceOnline,
            gatewayConfigured: true,
          }
        : undefined,
      disableLocalSystem,
      disabledPluginIds,
      executionPlan,
      globalMemoryEnabled,
      hasEnabledKnowledgeBases,
      isBotConversation,
      isGroupSupervisor,
      modelAbilities,
      // Context-aware builtin manifests: inside a sub-agent (or group) run,
      // lobe-agent drops `callSubAgent` so the model can't recurse into nested
      // sub-agents (which the runtime rejects, looping until the inactivity
      // watchdog kills the op). Mirrors the frontend `createAgentToolsEngine`.
      // `executionEnv` mirrors the resolved plan, while preserving the local
      // target for a routed desktop because its readFile implementation can
      // return images. It also keeps the `device-unrouted` degradation, where
      // the user picked a local device that is offline and exec silently lands
      // in the sandbox.
      // For bot conversations we also pass the IM platform so `lobe-message`
      // can drop APIs the platform can't fulfil (e.g. WeChat has no
      // `readMessages`).
      manifestContext: {
        ...(botContext?.platform && {
          botPlatform: {
            id: botContext.platform,
            unsupportedMessageApis: platformRegistry.getPlatform(botContext.platform)
              ?.unsupportedMessageApis,
          },
        }),
        executionEnv: executionPlanToManifestExecutionEnv(executionPlan, localDeviceId),
        executionEnvUnroutedReason:
          executionPlan.kind === 'device-unrouted' ? executionPlan.reason : undefined,
        isSubAgent: appContext?.isSubAgent,
        scope: appContext?.scope ?? undefined,
      },
      model,
      provider,
      useApplicationBuiltinSearchTool: searchDecision.useApplicationBuiltinSearchTool,
    });

    // 5f. Generate tools and manifest map
    const pluginIds = exclusivePluginIds
      ? agentPlugins
      : [
          ...new Set([
            ...agentPlugins,
            ...(disableLocalSystem ? [] : [LocalSystemManifest.identifier]),
            RemoteDeviceManifest.identifier,
            // Include LobeHub Skills and Composio tools so they are passed to generateToolsDetailed
            ...activeLobehubSkillManifests.map((m) => m.identifier),
            ...activeComposioManifests.map((m) => m.identifier),
            // Connector manifests are also injected as additionalManifests
            ...activeConnectorManifests.map((m) => m.identifier),
          ]),
        ];
    log('execAgent: agent configured plugins: %O', pluginIds);

    const isManualMode = agentConfig.chatConfig?.skillActivateMode === 'manual';

    toolsResult = toolsEngine.generateToolsDetailed({
      excludeDefaultToolIds: isManualMode ? manualModeExcludeToolIds : undefined,
      model,
      provider,
      skipDefaultTools: !!exclusivePluginIds,
      toolIds: pluginIds,
    });

    tools = toolsResult.tools;
    log('execAgent: enabled tool ids: %O', toolsResult.enabledToolIds);

    // Single guard for every `toolManifestMap[id] = ...` ingest below.
    // Mirrors the post-merge filter in `createServerToolsEngine`: an
    // installed plugin, a LobeHub Skill, or a Composio manifest declaring
    // `identifier: 'lobe-remote-device'` would otherwise reach the
    // activator-discovery map and let an external bot sender enable it
    // (). Centralising the check at the ingest layer means
    // every future manifest source automatically inherits the wall.
    //
    // A device-LOCKED run (routed, or explicitly bound but offline) keeps
    // local-system but must not expose the remote-device picker: leaving it
    // discoverable lets the activator's explicit activation bypass the rule
    // gate and re-surface the device list mid-run — inviting redundant
    // activateDevice calls or switching to a machine the user never chose.
    // Enforced here (not as a point deletion after the seed) so the later
    // Skill/Composio ingest loops cannot re-add the identifier.
    const isManifestIngestAllowed = (identifier: string): boolean => {
      if (exclusivePluginIds && !exclusivePluginIds.includes(identifier)) return false;
      if (disabledPluginIdSet.has(identifier)) return false;
      if (!canUseDevice && isDeviceToolIdentifier(identifier)) return false;
      if (deviceLocked && REMOTE_DEVICE_TOOL_IDENTIFIERS.has(identifier)) return false;
      return true;
    };

    // Start with the scoped manifest map (pluginIds + defaultToolIds)
    const manifestMap = toolsEngine.getEnabledPluginManifests(pluginIds);
    manifestMap.forEach((manifest, id) => {
      if (!isManifestIngestAllowed(id)) return;
      toolManifestMap[id] = manifest;
    });

    // Also include discoverable builtin tools that are not yet in the map,
    // so the activator can find their manifests when dynamically enabling them
    // (e.g., lobe-creds, lobe-task). Exclude discoverable:false tools to prevent
    // internal infrastructure tools from being surfaced to the activator.
    const allowedBuiltinTools = buildAllowedBuiltinTools({
      canUseDevice,
      deviceLocked,
      disableLocalSystem,
    });
    // Effective runtimeMode from the plan's resolved target — same value the
    // engine derives, single derivation point.
    const agentRuntimeMode = executionTargetToRuntimeMode(executionPlan.target);
    // When sandbox is not the active runtime, remove lobe-cloud-sandbox from the
    // manifest map. The initial seed via getEnabledPluginManifests (which includes
    // defaultToolIds) may have already placed it there, and the allowedBuiltinTools
    // loop below only guards the discoverable-builtin append path. Deleting here
    // covers both sources in a single point.
    if (agentRuntimeMode !== 'cloud') {
      delete toolManifestMap[CloudSandboxManifest.identifier];
    }
    // Same single-point deletion for the device tools: a `none` / `sandbox`
    // session must not expose the remote-device proxy either — leaving it
    // discoverable would let the model activate a device mid-run and bypass
    // the execution plan ("无设备" means NO device, not "no device yet").
    // Scoped to gateway deployments: in the standalone Electron deployment
    // (no DEVICE_GATEWAY) local-system routes in-process via the 'client'
    // executor marking below, and the desktop client owns the tool gate.
    const stripDeviceTools = gatewayConfigured && !deviceCapable;
    if (stripDeviceTools) {
      delete toolManifestMap[RemoteDeviceManifest.identifier];
      delete toolManifestMap[LocalSystemManifest.identifier];
    }
    for (const tool of allowedBuiltinTools) {
      if (!isManifestIngestAllowed(tool.identifier)) continue;
      // lobe-cloud-sandbox is only activator-discoverable when runtimeMode resolves
      // to 'cloud' (i.e. executionTarget='sandbox').
      if (tool.identifier === CloudSandboxManifest.identifier && agentRuntimeMode !== 'cloud')
        continue;
      // device tools are only activator-discoverable in device-capable sessions
      if (stripDeviceTools && isDeviceToolIdentifier(tool.identifier)) continue;
      if (tool.discoverable !== false && !toolManifestMap[tool.identifier]) {
        toolManifestMap[tool.identifier] = tool.manifest as LobeToolManifest;
      }
    }

    // lobe-local-system has `discoverable: isDesktop` in builtinTools, which
    // evaluates to false on the Node.js server side, so it never enters the
    // loop above. Explicitly inject it only when the device gateway is
    // configured AND the plan's target is 'local' — skip for sandbox/none
    // targets to avoid leaking local-system into non-local sessions. (The
    // plan already degrades to `none` when device access is denied, so no
    // separate `canUseDevice` check is needed here.)
    if (
      !disableLocalSystem &&
      isManifestIngestAllowed(LocalSystemManifest.identifier) &&
      gatewayConfigured &&
      agentRuntimeMode === 'local' &&
      !toolManifestMap[LocalSystemManifest.identifier]
    ) {
      toolManifestMap[LocalSystemManifest.identifier] = LocalSystemManifest as LobeToolManifest;
    }

    // Include lobehub skill and composio manifests for activator discovery.
    // Uses the disabled-filtered `active*Manifests` (not the raw
    // lobehubSkillManifests/composioManifests) — otherwise a disabled
    // skill/composio integration would be re-ingested here and shown to
    // the model as discoverable in <available_tools>, even though it was
    // correctly excluded from the actual invocation pool above.
    for (const manifest of activeLobehubSkillManifests) {
      if (!isManifestIngestAllowed(manifest.identifier)) continue;
      if (!toolManifestMap[manifest.identifier]) {
        toolManifestMap[manifest.identifier] = manifest;
      }
    }
    for (const manifest of activeComposioManifests) {
      if (!isManifestIngestAllowed(manifest.identifier)) continue;
      if (!toolManifestMap[manifest.identifier]) {
        toolManifestMap[manifest.identifier] = manifest;
      }
    }

    for (const manifest of activeLobehubSkillManifests) {
      if (!isManifestIngestAllowed(manifest.identifier)) continue;
      toolSourceMap[manifest.identifier] = 'lobehubSkill';
    }
    for (const manifest of activeComposioManifests) {
      if (!isManifestIngestAllowed(manifest.identifier)) continue;
      toolSourceMap[manifest.identifier] = 'composio';
    }

    // Mark tools that must run on the user's machine (local-system, stdio
    // MCP) for direct client dispatch only in the standalone deployment
    // where no DEVICE_GATEWAY is configured. In that mode the legacy
    // Remote Device proxy isn't available and the embedded Electron runs
    // both the server and the executor, so tools route in-process.
    //
    // With a device-gateway configured, every caller (desktop UI, web,
    // IM/bot) converges on the device-gateway path: tool calls tunnel to
    // a registered device's WS connection. `executor` stays unset so the
    // RemoteDevice proxy resolves the route.
    if (!gatewayConfigured) {
      for (const id of Object.keys(toolManifestMap)) {
        if (toolManifestMap[id]?.executors?.includes('client')) {
          toolExecutorMap[id] = 'client';
        }
      }
      for (const plugin of installedPlugins) {
        if (plugin.customParams?.mcp?.type === 'stdio' && manifestMap.has(plugin.identifier)) {
          toolExecutorMap[plugin.identifier] = 'client';
        }
      }
      for (const connector of connectorsMcp) {
        if (connector.mcpConnectionType === 'stdio' && manifestMap.has(connector.identifier)) {
          toolExecutorMap[connector.identifier] = 'client';
        }
      }
    }

    log(
      'execAgent: generated %d tools, %d lobehub skills, %d composio tools',
      tools?.length ?? 0,
      lobehubSkillManifests.length,
      composioManifests.length,
    );

    const agentSelfIterationEnabled = agentConfig.chatConfig?.selfIteration?.enabled === true;
    const isLobeAiAgent = isLobeAiAgentSlug(agentSlug);
    const shouldCheckUserSelfIterationGate =
      !disableSelfFeedbackIntentTool && (agentSelfIterationEnabled || isLobeAiAgent);
    if (shouldCheckUserSelfIterationGate) {
      const featureUserEnabled = await isAgentSignalEnabledForUser(deps.db, deps.userId);
      const effectiveAgentSelfIterationEnabled = resolveAgentSelfIterationCapability({
        agentSelfIterationEnabled,
        isAgentSelfIterationFeatureEnabled: featureUserEnabled,
        isLobeAiAgent,
      });

      if (
        shouldExposeSelfFeedbackIntentTool({
          agentSelfIterationEnabled: effectiveAgentSelfIterationEnabled,
          disableSelfFeedbackIntentTool,
          featureUserEnabled,
        })
      ) {
        tools = tools ?? [];
        injectSelfFeedbackIntentTool({
          enabledToolIds: toolsResult.enabledToolIds,
          manifestMap: toolManifestMap,
          sourceMap: toolSourceMap,
          tools,
        });
        log('execAgent: injected self-feedback intent declaration tool');
      }
    }
  }

  // Inject client function tools from Response API
  const CLIENT_FN_IDENTIFIER = 'lobe-client-fn';
  if (functionTools?.length) {
    for (const ft of functionTools) {
      tools?.push({
        function: {
          description: ft.description,
          name: `${CLIENT_FN_IDENTIFIER}____${ft.name}`,
          parameters: ft.parameters,
        },
        type: 'function',
      });
    }
    toolSourceMap[CLIENT_FN_IDENTIFIER] = 'client';
    toolManifestMap[CLIENT_FN_IDENTIFIER] = {
      api: functionTools.map((ft) => ({
        description: ft.description ?? '',
        name: ft.name,
        parameters: ft.parameters ?? {},
      })),
      identifier: CLIENT_FN_IDENTIFIER,
      meta: { title: 'Client Functions' },
      type: 'default',
    };
    toolsResult.enabledToolIds.push(CLIENT_FN_IDENTIFIER);
  }

  // Override RemoteDevice manifest's systemRole with the dynamic device
  // list prompt. Gated on `canUseDevice` so an external bot sender's turn
  // never sees the owner's device inventory in the LLM system prompt — the
  // engine gate above already drops the manifest, but other paths (e.g.
  // discoverable manifests for the activator) still leave the entry in
  // `toolManifestMap`. Without this guard, the device list leaks into the
  // context regardless of whether the tool was actually enabled.
  if (canUseDevice && toolManifestMap[RemoteDeviceManifest.identifier]) {
    toolManifestMap[RemoteDeviceManifest.identifier] = {
      ...toolManifestMap[RemoteDeviceManifest.identifier],
      systemRole: generateSystemPrompt(onlineDevices),
    };
  }

  return {
    activeDeviceId,
    activeDeviceScope,
    agentPlugins,
    builtinModels,
    composioManifests,
    connectorManifests,
    executionPlan,
    hasAgentDocuments,
    hasEnabledKnowledgeBases,
    lobehubSkillManifests,
    onlineDevices,
    operationAgentGroup,
    searchDecision,
    toolExecutorMap,
    toolManifestMap,
    toolSourceMap,
    tools,
    toolsEngine,
    toolsResult,
  };
};
