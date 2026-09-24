import { CredsIdentifier } from '@lobechat/builtin-tool-creds';
import { GoalIdentifier, isGoalPrompt } from '@lobechat/builtin-tool-goal';
import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
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
import type { DeviceUnavailableErrorData } from '@lobechat/device-gateway-client';
import {
  readFrozenModelFacts,
  resolveClientExecutors,
  resolveDiscoveryPool,
  resolveInvocationToolIds,
} from '@lobechat/mecha';
import type {
  ChatTopicBotContext,
  FrozenCredentialFacts,
  FrozenModelFacts,
  RequestTrigger,
} from '@lobechat/types';
import {
  agentShareFileAccessScope,
  getActivePluginIds,
  ordinaryFileAccessScope,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import type { ModelAbilities } from 'model-bank';

import { loadModels } from '@/business/client/model-bank/loadModels';
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
  isDeviceCapablePlan,
  isDeviceLockedPlan,
  resolveExecutionPlan,
  resolveToolMode,
} from '@/helpers/executionTarget';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { patchManifestWithPermissions } from '@/libs/mcp/connectorPermissionCheck';
import { resolveModelMediaCapabilities } from '@/server/modules/AgentRuntime/resolveModelMediaCapabilities';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type { ServerAgentToolsContext } from '@/server/modules/Mecha';
import { createServerAgentToolsEngine } from '@/server/modules/Mecha';
import { createServerModelParamsProviders } from '@/server/modules/Mecha/ModelParams/providers';
import type { AgentDocumentsService } from '@/server/services/agentDocuments';
import {
  isAgentSignalEnabledForUser,
  isLobeAiAgentSlug,
  resolveAgentSelfIterationCapability,
} from '@/server/services/agentSignal/featureGate';
import { resolveUnsupportedMessageApis } from '@/server/services/bot/platforms/messageCapabilities';
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

import { buildAllowedBuiltinTools } from '../deviceToolRegistry';
import { buildBotConversationGroupContext, buildGroupAgentContext } from '../helpers/groupContext';
import {
  getMediaAvailabilityFromFileTypes,
  getMediaAvailabilityFromMessages,
  isMultimodalUnderstandingConfigured,
} from '../helpers/mediaAvailability';
import { resolveServerSearchDecision } from '../searchDecision';
import {
  filterPluginsByShareGate,
  getShareGrantActivatedPluginIds,
  shareGateGrantsCloudSandbox,
} from '../shareGate';
import type { ExecRunContext, InternalExecAgentParams } from '../types';
import { markDegradedStage, traceDiscoveryStage } from './discoveryTracing';

const log = debug('lobe-server:ai-agent-service');

/**
 * Start a read now and keep its rejection for the caller's `await`.
 *
 * A promise that rejects before anything awaits it trips Node's
 * `unhandledRejection` even though this code does await it a few lines later,
 * so register a no-op handler on the original and hand the same promise back.
 */
const started = <T>(task: Promise<T>): Promise<T> => {
  task.catch(() => undefined);
  return task;
};

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
  /**
   * Mime types of the raw bot/IM uploads. The stage only ever looked at the
   * mime type, and keeping the request JSON-safe is what lets a deferred init
   * carry it on the operation state.
   */
  externalFileTypes?: string[];
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
  /**
   * Tells the model whose connected account each borrowed tool runs on. Run
   * context: it travels on the operation and the context engine injects it.
   */
  connectorOwnershipNote?: string;
  /**
   * Credentials listed once for the whole operation; see
   * {@link FrozenCredentialFacts}. Absent when the run cannot inject
   * credentials.
   *
   * Deliberately still a promise: awaiting it here would put a Market round
   * trip between tool discovery and operation preparation, on the path to the
   * first token. The caller awaits it once the preparation it overlaps with is
   * done. Never rejects — a failed read resolves to `undefined` and the run
   * reads the list live, as it did before the snapshot existed.
   */
  credentialFactsPromise?: Promise<FrozenCredentialFacts | undefined>;
  executionPlan?: ExecutionPlan;
  hasAgentDocuments: boolean;
  hasEnabledKnowledgeBases: boolean;
  lobehubSkillManifests: LobeToolManifest[];
  /** Model facts read once for the whole operation; see {@link FrozenModelFacts}. */
  modelFacts: FrozenModelFacts;
  modelMediaCapabilities: Pick<ModelAbilities, 'audio' | 'video' | 'vision'>;
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
 * Returns the connector credential ownership note as run context when the run
 * borrows connectors other members authorized; the context engine injects it.
 */
/**
 * The credentials the run may reference, read once. Inside a workspace an agent
 * only sees the workspace's shared organization credentials, never the
 * operator's personal ones — the scope is recorded on the snapshot so a step in
 * another scope falls back to a live read.
 *
 * Never fails the turn: without an answer the steps read the list live, exactly
 * as they did before the snapshot existed.
 */
const readCredentialFacts = async (
  deps: ToolDiscoveryDeps,
): Promise<FrozenCredentialFacts | undefined> => {
  try {
    const marketService = await deps.getMarketService();
    const result = deps.workspaceId
      ? await marketService.market.organizations.creds({ workspaceId: deps.workspaceId }).list()
      : await marketService.market.creds.list();
    const creds = (result as any)?.data ?? [];
    return {
      credentials: creds.map((cred: any) => ({
        description: cred.description,
        key: cred.key,
        name: cred.name,
        ownerDisplayName: cred.ownerDisplayName,
        ownerType: cred.ownerType,
        type: cred.type,
      })),
      workspaceId: deps.workspaceId,
    };
  } catch (error) {
    log('execAgent: failed to freeze credential facts: %O', error);
    return undefined;
  }
};

export const discoverTools = async (
  deps: ToolDiscoveryDeps,
  ctx: ExecRunContext,
  input: ToolDiscoveryInput,
): Promise<ToolDiscoveryResult> => {
  /** Filled below when the run borrows connectors; returned as run context. */
  let connectorOwnershipNote: string | undefined;
  const {
    agentConfig,
    appContext,
    assistantMessageId,
    canUseDevice,
    model,
    prompt,
    provider,
    resolvedAgentId,
    shareGate,
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
    externalFileTypes: rawExternalFileTypes,
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
  /** Started once the tool set is known; awaited at the return. */
  let credentialFactsPromise: Promise<FrozenCredentialFacts | undefined> | undefined;
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
            ...(shareGate ? getShareGrantActivatedPluginIds(shareGate) : []),
          ]),
        ];

  // Share allowlist runs EARLY, before connector resolution / credential
  // decryption / stale-tool refresh scheduling — otherwise an ungranted HTTP
  // connector pinned on the creator's agent would still be resolved and its
  // OAuth credentials touched for a visitor turn (issuing background MCP
  // traffic and refresh jobs on behalf of the creator). The later pass right
  // before manifest discovery (~line 618) stays as defense in depth: internal
  // additions like the topic-reference / bot message / multimodal
  // understanding tool are appended after this point and must run through the
  // same allowlist.
  if (shareGate) {
    agentPlugins = filterPluginsByShareGate(agentPlugins, shareGate);
  }

  // Model metadata is needed both for tool support checks and agent-management context.
  const builtinModels = await loadModels();
  // Started, not awaited: the tool reads below hit other backends entirely, so
  // this round trip overlaps them instead of gating them.
  const modelMetadataTask = traceDiscoveryStage('model_metadata', async (span) => {
    const results = await Promise.allSettled([
      new AiModelModel(deps.db, deps.userId, deps.workspaceId).findByIdAndProvider(model, provider),
      new AiProviderModel(deps.db, deps.userId, deps.workspaceId).findById(provider),
    ]);
    markDegradedStage(
      span,
      results.filter((result) => result.status === 'rejected').length,
      'metadata lookups',
    );
    return results;
  });
  /**
   * Connector resolution: the gatekeeper decrypts the stored OAuth tokens, or
   * `buildConnectorManifests` gets no auth and every tool call 401s.
   */
  async function readConnectors() {
    // Snapshot the candidate ids now — `agentPlugins` gains turn-scoped builtins
    // (topic reference, bot message, multimodal understanding) further down, and
    // those must not reach connector resolution or the stale-tools refresh.
    const candidateIds = [...agentPlugins];
    let connectorGateKeeper: KeyVaultsGateKeeper | undefined;
    try {
      connectorGateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    } catch (err) {
      log('execAgent: failed to init gatekeeper for connector credentials: %O', err);
    }

    return traceDiscoveryStage('connectors', async () => {
      const connectors =
        candidateIds.length > 0
          ? await deps.connectorModel.resolveByIdentifiers(
              candidateIds,
              resolvedAgentId,
              connectorGateKeeper,
            )
          : [];

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

      return { connectorGateKeeper, connectors, connectorsMcp, connectorTools };
    });
  }

  async function readLobehubSkillManifests(): Promise<LobeToolManifest[]> {
    try {
      const marketService = await deps.getMarketService();
      return await traceDiscoveryStage('lobehub_skills', async (span) => {
        // The service degrades to fewer (or zero) manifests instead of
        // throwing, so count what it absorbed — otherwise a Market timeout
        // looks exactly like a user with no connected skills.
        let failureCount = 0;
        const manifests = await marketService.getLobehubSkillManifests({
          onError: () => {
            failureCount += 1;
          },
        });
        span.setAttribute('lobehub.tool_discovery.manifest_count', manifests.length);
        markDegradedStage(span, failureCount, 'skill discovery requests');
        return manifests;
      });
    } catch (error) {
      log('execAgent: failed to fetch lobehub skill manifests: %O', error);
      return [];
    }
  }

  async function readDevicePool(): Promise<DeviceAttachment[]> {
    if (!deviceGateway.isConfigured) return [];
    try {
      // Personal pool ∪ the current workspace pool, DB rows ⊕ gateway online,
      // tagged with `scope` and the user-set `friendlyName` alias (see
      // `getScopedOnlineDevices`) so the systemRole snapshot lets the model
      // tell a personal machine apart from its workspace-enrolled counterpart
      // (same physical machine under both principals). Keep only live devices:
      // downstream `onlineDeviceIds` / `deviceOnline` treat this list as the
      // online set.
      let devices = (
        await traceDiscoveryStage('online_devices', () =>
          getScopedOnlineDevices(deps.db, deps.userId, deps.workspaceId),
        )
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
        if (!devices.some((d) => d.deviceId === boundId)) {
          const personalPool = await getScopedOnlineDevices(deps.db, deps.userId).catch(
            () => [] as DeviceAttachment[],
          );
          const personalMatch = personalPool.find((d) => d.deviceId === boundId && d.online);
          if (personalMatch) {
            devices = [...devices, personalMatch];
            log(
              'execAgent: augmented device pool with caller personal device %s (per-user override)',
              boundId,
            );
          }
        }
      }
      log('execAgent: found %d online device(s)', devices.length);
      return devices;
    } catch (error) {
      log('execAgent: failed to query device list: %O', error);
      return [];
    }
  }

  async function readAttachedFileTypes(): Promise<string[]> {
    if (!attachedFileIds || attachedFileIds.length === 0) return [];
    const fileModel = new FileModel(deps.db, deps.userId, deps.workspaceId);
    const uniqueFileIds = Array.from(new Set(attachedFileIds));
    const fileRecords = await traceDiscoveryStage('attached_files', () =>
      fileModel.findByIds(
        uniqueFileIds,
        shareGate ? agentShareFileAccessScope(shareGate) : ordinaryFileAccessScope,
      ),
    );
    return fileRecords.map((file) => file.fileType || '');
  }

  // Every other read this send needs, started together. They hit different
  // backends — Postgres rows, the Market's live skill discovery, the device
  // gateway — and none of them feeds another, so the user waits for the slowest
  // one instead of the sum of all of them. Each keeps the degrade-to-empty
  // behavior it had when it ran in sequence; only the plugin list still fails
  // the run, because a run with no plugins is not the same run.
  const toolReads = disableTools
    ? undefined
    : {
        // The fallbacks sit OUTSIDE `traceDiscoveryStage` on purpose: the wrapper
        // only marks a span errored when its callback throws, so absorbing the
        // failure inside it would report a healthy stage for a failed read.
        agentDocuments: started(
          traceDiscoveryStage('agent_documents', () =>
            deps.agentDocumentsService.hasDocuments(resolvedAgentId),
          ).catch(() => false), // non-critical
        ),
        attachedFileTypes: started(readAttachedFileTypes()),
        composioManifests: started(
          traceDiscoveryStage('composio', () =>
            deps.composioService.getComposioManifests(resolvedAgentId),
          ).catch((error) => {
            log('execAgent: failed to fetch composio manifests: %O', error);
            return [] as LobeToolManifest[];
          }),
        ),
        connectors: started(readConnectors()),
        devicePool: started(readDevicePool()),
        installedPlugins: started(
          traceDiscoveryStage('installed_plugins', () => deps.pluginModel.query()),
        ),
        lobehubSkillManifests: started(readLobehubSkillManifests()),
      };

  const [modelMetadataResult, providerMetadataResult] = await modelMetadataTask;
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
  const modelMediaCapabilities =
    resolveModelMediaCapabilities({
      builtinModels,
      model,
      provider,
      userAbilities: activeModelAbilities,
    }) ?? {};
  // The rest of the run's model facts, read here because this stage already
  // holds the loaded bank and the user's model row. Everything downstream — one
  // per step, retries included — reads them back off the operation instead.
  const modelFacts = await readFrozenModelFacts(
    {
      agent: { id: agentConfig.id },
      mediaCapabilities: modelMediaCapabilities,
      model,
      provider,
      topicId,
    },
    {
      ...createServerModelParamsProviders({
        builtinModels,
        serverDB: deps.db,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      }),
      // Reuse the row read above rather than querying it a second time.
      getUserModelRow: async () =>
        activeModelMetadata
          ? {
              abilities: activeModelMetadata.abilities,
              displayName: activeModelMetadata.displayName,
              extendParams: activeModelMetadata.settings?.extendParams ?? undefined,
            }
          : null,
    },
  );
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

  if (!toolReads) {
    log('execAgent: tools disabled by disableTools flag, skipping all tool discovery');
  } else {
    // 5a. Get installed plugins from database. Disabled identifiers are
    // excluded from this candidate pool entirely — not just from the pinned
    // `rules` allowlist — because `createEnableChecker`'s explicit-activation
    // bypass (auto activator) short-circuits before rules are consulted, so a
    // present-but-rule-disabled manifest could still be auto-activated.
    const disabledPluginIdSet = new Set(disabledPluginIds);
    const installedPlugins = (await toolReads.installedPlugins).filter(
      (p) => !disabledPluginIdSet.has(p.identifier),
    );
    log(
      'execAgent: got %d installed plugins (%d disabled excluded)',
      installedPlugins.length,
      disabledPluginIdSet.size,
    );

    // 5a-1. Resolve connectors — connector identifier takes priority over plugin.
    const { connectorGateKeeper, connectors, connectorsMcp, connectorTools } =
      await toolReads.connectors;

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
          // Returned as run context for the context engine to inject, rather
          // than concatenated onto the agent's systemRole here.
          connectorOwnershipNote = note;
          log(
            'execAgent: injected tool credential ownership note for %d connector(s)',
            borrowed.length,
          );
        }
      }
    } catch (err) {
      log('execAgent: failed to build tool credential ownership note: %O', err);
    }

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

    // 5c / 5d. LobeHub Skills and Composio manifests, read in the wave above.
    lobehubSkillManifests = await toolReads.lobehubSkillManifests;
    log('execAgent: got %d lobehub skill manifests', lobehubSkillManifests.length);
    composioManifests = await toolReads.composioManifests;
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

    hasAgentDocuments = await toolReads.agentDocuments;

    log('execAgent: isBotConversation=%s', isBotConversation);

    // Device context for the ToolsEngine enableChecker, read in the wave above.
    const gatewayConfigured = deviceGateway.isConfigured;
    const agentBoundDeviceId = agentConfig.agencyConfig?.boundDeviceId;
    const boundDeviceId = topicBoundDeviceId || agentBoundDeviceId;
    onlineDevices = await toolReads.devicePool;
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
    const externalFileTypes = rawExternalFileTypes ?? [];
    const inputFileTypes = [...externalFileTypes, ...(await toolReads.attachedFileTypes)];
    const inputMediaAvailability = getMediaAvailabilityFromFileTypes(inputFileTypes);
    let historyMediaAvailability = { hasAudios: false, hasImages: false, hasVideos: false };
    const multimodalUnderstandingConfigured = isMultimodalUnderstandingConfigured();

    if (
      multimodalUnderstandingConfigured &&
      ((!modelMediaCapabilities?.audio && !inputMediaAvailability.hasAudios) ||
        (!modelMediaCapabilities?.vision && !inputMediaAvailability.hasImages) ||
        (!modelMediaCapabilities?.video && !inputMediaAvailability.hasVideos))
    ) {
      historyMediaAvailability = getMediaAvailabilityFromMessages(await loadHistoryMessages());
    }

    const needsAudioUnderstanding =
      (inputMediaAvailability.hasAudios || historyMediaAvailability.hasAudios) &&
      !modelMediaCapabilities?.audio;
    const needsImageUnderstanding =
      (inputMediaAvailability.hasImages || historyMediaAvailability.hasImages) &&
      !modelMediaCapabilities?.vision;
    const needsVideoUnderstanding =
      (inputMediaAvailability.hasVideos || historyMediaAvailability.hasVideos) &&
      !modelMediaCapabilities?.video;
    const shouldEnableMultimodalUnderstanding =
      multimodalUnderstandingConfigured &&
      (needsAudioUnderstanding || needsImageUnderstanding || needsVideoUnderstanding);
    agentPlugins = [
      ...agentPlugins,
      ...(hasTopicReference ? ['lobe-topic-reference'] : []),
      ...(isBotConversation ? [MessageToolIdentifier] : []),
      ...(shouldEnableMultimodalUnderstanding ? [LobeAgentManifest.identifier] : []),
    ];

    // Share allowlist filters the full candidate set (pinned + mentioned +
    // internal additions) before manifest discovery. This only trims which
    // plugin ids get *activated*; the separate skill candidate pool built in
    // `operationPrep` (`skills`, consumed by `SkillEngine`) needs its own pass
    // against the same allowlist, since building the skill list is a distinct
    // step from `SkillEngine.generate` and is not scoped by the plugin id list
    // on its own. The operationToolSet snapshot then carries the restricted
    // surface into every later step.
    //
    // Defense in depth: the same filter also runs at the top of
    // `discoverTools` (before connector resolution) so that ungranted
    // connectors never reach `resolveByIdentifiers` /
    // `scheduleStaleConnectorToolsRefresh`. Keep this second pass — the
    // internal additions above (topic reference, bot message tool,
    // multimodal understanding) are appended after the first pass and would
    // otherwise slip through.
    if (shareGate) {
      agentPlugins = filterPluginsByShareGate(agentPlugins, shareGate);
    }

    // Resolve THE device decision for this run. All rules live in
    // `resolveExecutionPlan` (gated on `canUseDevice` first, `none`/`sandbox`
    // never route to a device, offline bindings stay unrouted, unbound runs
    // auto-activate only with exactly one device online). Without the
    // `canUseDevice` gate an external bot sender's turn would still populate
    // `state.binding.device.id`, and `buildStepToolDelta` re-injects
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
    //
    // A share visitor never passes `canUseDevice`, so a creator agent that
    // targets `local`/`auto` would collapse to `none` and silently drop a
    // `lobe-cloud-sandbox` grant (the sandbox manifest only materializes when
    // the plan resolves to `sandbox`). `sandboxFallback` keeps that decision
    // inside the resolver instead of patching its result here.
    executionPlan = resolveExecutionPlan({
      agencyConfig: agentConfig.agencyConfig,
      canUseDevice,
      chatConfig: agentConfig.chatConfig ?? undefined,
      clientExecutionAvailable: gatewayConfigured,
      localDeviceId,
      onlineDeviceIds: onlineDevices.map((device) => device.deviceId),
      requestedDeviceId,
      sandboxFallback: shareGate ? shareGateGrantsCloudSandbox(shareGate) : false,
      trigger: requestTrigger,
    });
    // A fixed device target must never degrade to the cloud sandbox or a
    // different device. Persist a visible assistant error and fail the RPC
    // before tool/runtime preparation so no operation can start elsewhere.
    if (
      isFixedDeviceTarget &&
      boundDeviceId &&
      resolveToolMode(agentConfig.chatConfig ?? undefined) !== 'chat' &&
      executionPlan.kind !== 'device'
    ) {
      const errorData: DeviceUnavailableErrorData = {
        code: 'DEVICE_NOT_FOUND',
        deviceId: boundDeviceId,
        retryable: true,
        scope: deps.workspaceId ? 'workspace' : 'personal',
        ...(deps.workspaceId ? { workspaceId: deps.workspaceId } : {}),
      };
      const detail =
        executionPlan.kind === 'device-unrouted' && executionPlan.reason === 'bound-device-offline'
          ? 'The device fixed by this agent is offline. Ask an editor to bring it online or change the agent device policy.'
          : 'The device fixed by this agent is unavailable for this run. Ask an editor to check the agent device policy.';
      await deps.messageModel.update(assistantMessageId, {
        content: '',
        error: {
          body: { detail, ...errorData },
          message: 'Fixed agent device unavailable',
          type: 'ServerAgentRuntimeError',
        },
      });
      throw new TRPCError({
        cause: { data: errorData },
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

    // Opt-in capability from the existing system-info RPC. Older desktop and CLI
    // clients omit it, so they must never receive the new Computer Use manifest.
    const systemInfoDeviceId = canUseDevice && !disableLocalSystem ? activeDeviceId : undefined;
    const supportedDeviceTools = systemInfoDeviceId
      ? (
          await traceDiscoveryStage('device_system_info', () =>
            ctx.runFacts.deviceSystemInfo(systemInfoDeviceId, activeDeviceScope),
          )
        )?.supportedTools
      : undefined;

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
            supportedTools: supportedDeviceTools,
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
      // `readMessages`). Telegram Guest Mode uses a stricter overlay —
      // the bot is not a chat member and has no regular channel tools.
      manifestContext: {
        ...(botContext?.platform && {
          botPlatform: {
            id: botContext.platform,
            unsupportedMessageApis: resolveUnsupportedMessageApis(
              botContext.platform,
              botContext.platformThreadId,
            ),
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
    // Which identifiers the engine considers, what the activator may discover
    // mid-run, and which tools dispatch to the client are shared rules in
    // `@lobechat/mecha`; this pipeline only supplies the run's facts.
    const pluginIds = resolveInvocationToolIds({
      agentPlugins,
      composioIds: activeComposioManifests.map((m) => m.identifier),
      connectorIds: activeConnectorManifests.map((m) => m.identifier),
      disableLocalSystem,
      exclusivePluginIds,
      lobehubSkillIds: activeLobehubSkillManifests.map((m) => m.identifier),
    });
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

    // Only a run that can inject credentials renders {{CREDS_LIST}}. Kick the
    // read off here and await it at the end: it is one Market round trip, and
    // every step of the run reads the answer back off the operation instead of
    // asking again.
    if (toolsResult.enabledToolIds?.includes(CredsIdentifier)) {
      credentialFactsPromise = readCredentialFacts(deps);
    }

    // Start with the scoped manifest map (pluginIds + defaultToolIds)
    const manifestMap = toolsEngine.getEnabledPluginManifests(pluginIds);
    const discovery = resolveDiscoveryPool({
      builtinTools: buildAllowedBuiltinTools({
        canUseDevice,
        deviceLocked,
        disableLocalSystem,
        supportedDeviceTools: gatewayConfigured ? (supportedDeviceTools ?? []) : undefined,
      }),
      composio: activeComposioManifests,
      device: gatewayConfigured ? { supportedTools: supportedDeviceTools } : undefined,
      deviceAccess: { canUseDevice, deviceLocked },
      deviceCapable,
      disableLocalSystem,
      disabledPluginIds,
      enabledManifests: manifestMap,
      exclusivePluginIds,
      executionTarget: executionPlan.target,
      lobehubSkills: activeLobehubSkillManifests,
    });
    Object.assign(toolManifestMap, discovery.manifestMap);
    Object.assign(toolSourceMap, discovery.sourceMap);
    Object.assign(
      toolExecutorMap,
      resolveClientExecutors({
        enabledIds: new Set(manifestMap.keys()),
        hasDeviceProxy: gatewayConfigured,
        manifestMap: toolManifestMap,
        stdioIdentifiers: [
          ...installedPlugins
            .filter((plugin) => plugin.customParams?.mcp?.type === 'stdio')
            .map((plugin) => plugin.identifier),
          ...connectorsMcp
            .filter((connector) => connector.mcpConnectionType === 'stdio')
            .map((connector) => connector.identifier),
        ],
      }),
    );

    log(
      'execAgent: generated %d tools, %d lobehub skills, %d composio tools',
      tools?.length ?? 0,
      lobehubSkillManifests.length,
      composioManifests.length,
    );

    const agentSelfIterationEnabled = agentConfig.chatConfig?.selfIteration?.enabled === true;
    const isLobeAiAgent = isLobeAiAgentSlug(agentSlug);
    // Share-visitor fail-closed gate — never expose the
    // `declareSelfFeedbackIntent` tool to a share-visitor turn. This tool sits
    // outside the normal `toolManifestMap` / `applyShareGateToToolSet`
    // allowlist (it's injected directly into `tools` below), so the visitor's
    // own model call can reach it even with an empty `enabledToolIds`. Its
    // execution context is stamped with the share CREATOR's user id, and the
    // resulting `agent.self_feedback_intent.declared` event dispatches a full
    // autonomous background run under the creator's account, which can write
    // to the creator's memory. Same root cause as the `agent.user.message`
    // gate in `turnSetup`; `allowReadMemory` is a read-only grant so this must
    // not be conditional on it either.
    const shouldCheckUserSelfIterationGate =
      !shareGate && !disableSelfFeedbackIntentTool && (agentSelfIterationEnabled || isLobeAiAgent);
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
    connectorOwnershipNote,
    executionPlan,
    hasAgentDocuments,
    credentialFactsPromise,
    hasEnabledKnowledgeBases,
    lobehubSkillManifests,
    modelFacts,
    modelMediaCapabilities,
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
