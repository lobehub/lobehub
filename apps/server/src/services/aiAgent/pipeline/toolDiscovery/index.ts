import { CredsIdentifier } from '@lobechat/builtin-tool-creds';
import { DashboardIdentifier, isDashboardIdentifier } from '@lobechat/builtin-tool-dashboard';
import { GoalIdentifier, isGoalIdentifier, isGoalPrompt } from '@lobechat/builtin-tool-goal';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import type { DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import { generateSystemPrompt, RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import {
  injectSelfFeedbackIntentTool,
  SELF_FEEDBACK_INTENT_IDENTIFIER,
  shouldExposeSelfFeedbackIntentTool,
} from '@lobechat/builtin-tool-self-iteration';
import { manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import { getFeatureDisabledToolIds } from '@lobechat/builtin-tools/featureGates';
import type {
  AgentGroupConfig,
  LobeToolManifest,
  ToolExecutor,
  ToolsEngine,
  ToolSource,
} from '@lobechat/context-engine';
import {
  dropInvalidManifests,
  resolveClientExecutors,
  resolveDiscoveryPool,
  resolveInvocationToolIds,
} from '@lobechat/mecha';
import type { BuiltinToolResolveContext, FrozenCredentialFacts } from '@lobechat/types';
import { getActivePluginIds } from '@lobechat/types';
import debug from 'debug';

import { loadModels } from '@/business/client/model-bank/loadModels';
import { type ExecutionPlan, executionPlanToManifestExecutionEnv } from '@/helpers/executionTarget';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import type { ServerAgentToolsContext } from '@/server/modules/Mecha';
import { createServerAgentToolsEngine } from '@/server/modules/Mecha';
import { isAgentSignalEnabledForUser } from '@/server/services/agentSignal/featureGate';
import { resolveUnsupportedMessageApis } from '@/server/services/bot/platforms/messageCapabilities';
import { deviceGateway } from '@/server/services/deviceGateway';
import { buildPluginMcpParams } from '@/server/services/mcp/pluginParams';

import { buildAllowedBuiltinTools } from '../../deviceToolRegistry';
import {
  filterPluginsByShareGate,
  getShareGrantActivatedPluginIds,
  getShareGrantedExtensionIds,
} from '../../shareGate';
import type { ExecRunContext } from '../../types';
import {
  buildOwnershipNote,
  patchConnectorPermissions,
  scheduleConnectorRefresh,
} from './connectors';
import { resolveDevicePlan } from './devicePlan';
import { resolveModelContext, startModelMetadataRead } from './modelFacts';
import { readCredentialFacts, startToolReads } from './reads';
import { resolveOperationGroup, resolveTurnScopedPluginIds } from './turnContext';
import type { ToolDiscoveryDeps, ToolDiscoveryInput, ToolDiscoveryResult } from './types';

export type { ToolDiscoveryDeps, ToolDiscoveryInput, ToolDiscoveryResult } from './types';

const log = debug('lobe-server:ai-agent-service');

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
    canUseDevice,
    model,
    prompt,
    provider,
    resolvedAgentId,
    shareGate,
  } = ctx;
  const {
    additionalPluginIds,
    attachedFileIds,
    botContext,
    disableLocalSystem,
    disableSelfFeedbackIntentTool,
    disableTools,
    disabledPluginIds: requestedDisabledPluginIds,
    discordContext,
    exclusivePluginIds,
    externalFileTypes: rawExternalFileTypes,
    functionTools,
    globalMemoryEnabled,
    hasMentionedAgents,
    loadHistoryMessages,
    localDeviceId,
    requestedDeviceId,
    selectedToolIds,
    throwIfExecutionAborted,
    topicBoundDeviceId,
  } = input;
  // Feature-flagged builtin tools (e.g. builtin-dashboard) leave the pool while
  // their flag is off for this user; a flag read failure keeps them out.
  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(deps.userId).catch(
    () => undefined,
  );
  const disabledPluginIds = [
    ...requestedDisabledPluginIds,
    ...getFeatureDisabledToolIds(featureFlags),
  ];

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
            // An agent that pinned the goal or dashboard tool before its
            // rename still carries the legacy id; resolve it to the current one.
            ...getActivePluginIds(agentConfig?.plugins).map((id) =>
              isGoalIdentifier(id)
                ? GoalIdentifier
                : isDashboardIdentifier(id)
                  ? DashboardIdentifier
                  : id,
            ),
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
  // additions like the bot message / multimodal
  // understanding tool are appended after this point and must run through the
  // same allowlist.
  if (shareGate) {
    agentPlugins = filterPluginsByShareGate(agentPlugins, shareGate);
  }
  // The unpinned sources the activator may discover (connectors, Composio,
  // LobeHub Skills, installed plugins) need the same early cut for a share
  // run: only granted identifiers are read. A grant the owner later disabled
  // on the Agent is dropped here too, not only after discovery.
  const shareGrantedExtensionIds = shareGate
    ? new Set(
        [...getShareGrantedExtensionIds(shareGate)].filter(
          (identifier) => !disabledPluginIds.includes(identifier),
        ),
      )
    : undefined;

  // Model metadata is needed both for tool support checks and agent-management context.
  const builtinModels = await loadModels();
  // Started, not awaited: the tool reads below hit other backends entirely, so
  // this round trip overlaps them instead of gating them.
  const modelMetadataTask = startModelMetadataRead(deps, model, provider);

  // Every other read this send needs, started together; see `startToolReads`.
  const toolReads = disableTools
    ? undefined
    : startToolReads(deps, {
        agentConfig,
        attachedFileIds,
        candidateIds: [...agentPlugins],
        exclusivePluginIds,
        isGoalTurn,
        projectId: appContext?.projectId,
        requestedDeviceId,
        resolvedAgentId,
        shareGate,
        shareGrantedExtensionIds,
        topicId: ctx.topicId,
      });

  // The rest of the run's model facts, read here because this stage already
  // holds the loaded bank and the user's model row.
  const { modelFacts, modelMediaCapabilities, searchDecision } = await resolveModelContext(
    deps,
    ctx,
    builtinModels,
    modelMetadataTask,
  );

  if (!toolReads) {
    log('execAgent: tools disabled by disableTools flag, skipping all tool discovery');
  } else {
    // 5a. Get installed plugins from database. Disabled identifiers are
    // excluded from this candidate pool entirely — not just from the pinned
    // `rules` allowlist — because `createEnableChecker`'s explicit-activation
    // bypass (auto activator) short-circuits before rules are consulted, so a
    // present-but-rule-disabled manifest could still be auto-activated.
    // A share run keeps only granted plugins, so an ungranted one never reaches
    // the connector permission lookup or the activator pool below.
    const disabledPluginIdSet = new Set(disabledPluginIds);
    const installedPlugins = (await toolReads.installedPlugins).filter(
      (p) =>
        !disabledPluginIdSet.has(p.identifier) &&
        (!shareGrantedExtensionIds || shareGrantedExtensionIds.has(p.identifier)),
    );
    log(
      'execAgent: got %d installed plugins (%d disabled excluded)',
      installedPlugins.length,
      disabledPluginIdSet.size,
    );

    // 5a-1. Resolve connectors — connector identifier takes priority over plugin.
    const {
      connectorGateKeeper,
      connectors,
      connectorsMcp,
      connectorTools,
      discoverableConnectorManifests,
      discoverableConnectorsMcp,
      discoverableConnectorTools,
    } = await toolReads.connectors;

    // 5a-1b. Model awareness: tell the model whose connected account each
    // borrowed tool runs on (see `buildOwnershipNote`).
    connectorOwnershipNote = await buildOwnershipNote(deps, connectors);

    connectorManifests = buildConnectorManifests(connectorsMcp, connectorTools);

    scheduleConnectorRefresh(deps, {
      connectorGateKeeper,
      connectorsMcp,
      connectorTools,
      discoverableConnectorsMcp,
      discoverableConnectorTools,
    });

    // Only connectors that ACTUALLY produced a manifest (enabled + with synced
    // tools) replace a same-named plugin. Deriving the set from connectorsMcp
    // instead would let a disabled / not-yet-synced connector evict the plugin
    // while contributing no tools — leaving the runtime with nothing to call.
    // Unpinned connectors supersede a leftover plugin row the same way.
    const connectorIdentifierSet = new Set(
      [...connectorManifests, ...discoverableConnectorManifests].map((m) => m.identifier),
    );

    // Filter out plugin entries that are now handled by real MCP connectors.
    // `let` because community-MCP plugins may be patched with connector
    // permissions below (their connector row has no endpoint, so they stay here).
    // Composio connections also leave a plugin row behind (customParams.composio),
    // but they are executable only through `getComposioManifests`, which gates
    // on an ACTIVE connection and tags the tool source as `composio`. Letting a
    // PENDING/EXPIRED row through here exposes the full tool schema with no
    // Composio source, so every call falls to the builtin executor and fails
    // as "not implemented".
    let pluginsWithoutConnectors = installedPlugins
      .filter((p) => !connectorIdentifierSet.has(p.identifier) && !p.customParams?.composio)
      .map((plugin) => {
        const mcpParams = buildPluginMcpParams(plugin);
        return mcpParams && plugin.manifest
          ? { ...plugin, manifest: { ...plugin.manifest, type: 'mcp' as const, mcpParams } }
          : plugin;
      });
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
    // with connector tool permissions (see `patchConnectorPermissions`).
    ({ composioManifests, lobehubSkillManifests, pluginsWithoutConnectors } =
      await patchConnectorPermissions(deps, resolvedAgentId, {
        composioManifests,
        lobehubSkillManifests,
        pluginsWithoutConnectors,
      }));

    await throwIfExecutionAborted('tool discovery');

    // 5e. Create tools using Server AgentToolsEngine. Project knowledge counts:
    // every agent in a project searches it, even with none of its own.
    const projectScope = await toolReads.projectScope;
    hasEnabledKnowledgeBases =
      projectScope.hasKnowledgeBases ||
      (agentConfig.knowledgeBases?.some(
        (kb: { enabled?: boolean | null }) => kb.enabled === true,
      ) ??
        false);

    hasAgentDocuments = await toolReads.agentDocuments;
    const hasOversizedFiles = await toolReads.oversizedFiles;

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
    const modelAbilities =
      builtinModels.find((item) => item.id === model && item.providerId === provider)?.abilities ??
      builtinModels.find((item) => item.id === model)?.abilities;
    agentPlugins = [
      ...new Set([
        ...agentPlugins,
        ...(await resolveTurnScopedPluginIds({
          attachedFileTypes: await toolReads.attachedFileTypes,
          externalFileTypes: rawExternalFileTypes,
          isBotConversation,
          isProjectCoordinator: projectScope.isCoordinator,
          loadHistoryMessages,
          modelMediaCapabilities,
        })),
      ]),
    ];
    if (exclusivePluginIds) {
      agentPlugins = agentPlugins.filter((id) => exclusivePluginIds.includes(id));
    }

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
    // internal additions above (bot message tool, multimodal understanding)
    // are appended after the first pass and would
    // otherwise slip through.
    if (shareGate) {
      agentPlugins = filterPluginsByShareGate(agentPlugins, shareGate);
    }

    // Resolve THE device decision for this run; see `resolveDevicePlan`.
    const devicePlan = await resolveDevicePlan(deps, ctx, input, {
      boundDeviceId,
      gatewayConfigured,
      onlineDevices,
    });
    executionPlan = devicePlan.executionPlan;
    activeDeviceId = devicePlan.activeDeviceId;
    activeDeviceScope = devicePlan.activeDeviceScope;
    const { deviceCapable, deviceLocked, supportedDeviceTools } = devicePlan;

    const group = await resolveOperationGroup(deps, ctx, botContext);
    const { isGroupSupervisor } = group;
    operationAgentGroup = group.operationAgentGroup;

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
    const activeDiscoverableConnectorManifests = dropDisabledManifests(
      discoverableConnectorManifests,
    );

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
    // The discovery pool below resolves with the same context, so a tool
    // activated mid-run carries the trimmed manifest too.
    const manifestContext: BuiltinToolResolveContext = {
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
    };

    toolsEngine = createServerAgentToolsEngine(toolsContext, {
      additionalManifests: [
        ...activeLobehubSkillManifests,
        ...activeComposioManifests,
        ...activeConnectorManifests,
        // Known to the engine but never invocation candidates (they stay out of
        // `connectorIds` below), so they are not enabled by default — this only
        // lets a previous turn's activation pass the explicit-activation
        // re-check when the next operation restores it.
        ...activeDiscoverableConnectorManifests,
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
      hasOversizedFiles,
      isBotConversation,
      isGroupSupervisor,
      modelAbilities,
      manifestContext,
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
      // Installed-but-not-pinned plugins (`auto` in the three-state plugin
      // config): the model must be able to discover and activate them mid-run,
      // exactly as the client runtime lists them from `installedPlugins`.
      // They never join `enabledToolIds` — the engine's rules stay pinned-only
      // — so this widens what the activator can reach, not what the run gets
      // by default. Disabled ids were dropped in 5a and the pool's own ingest
      // wall re-checks them; a connector / Composio / LobeHub skill manifest
      // of the same identifier still wins, because the pool seeds this source
      // last.
      // Unpinned connectors join them on the same terms.
      installedManifests: [
        ...activeDiscoverableConnectorManifests,
        ...dropInvalidManifests(
          pluginsWithoutConnectors.map((plugin) => plugin.manifest as LobeToolManifest | undefined),
          'installedPlugins(auto)',
        ),
      ],
      lobehubSkills: activeLobehubSkillManifests,
      manifestContext,
      pageScope: manifestContext?.scope === 'page' && pluginIds.includes(PageAgentIdentifier),
    });
    Object.assign(toolManifestMap, discovery.manifestMap);
    Object.assign(toolSourceMap, discovery.sourceMap);
    Object.assign(
      toolExecutorMap,
      resolveClientExecutors({
        hasDeviceProxy: gatewayConfigured,
        manifestMap: toolManifestMap,
        stdioIdentifiers: [
          ...installedPlugins
            .filter((plugin) => plugin.customParams?.mcp?.type === 'stdio')
            .map((plugin) => plugin.identifier),
          ...[...connectorsMcp, ...discoverableConnectorsMcp]
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
    //
    // There is no per-agent switch: Labs → Self-evolving covers every agent.
    if (
      !shareGate &&
      !disableSelfFeedbackIntentTool &&
      (!exclusivePluginIds || exclusivePluginIds.includes(SELF_FEEDBACK_INTENT_IDENTIFIER))
    ) {
      // The run already reads `users.preference` for expertise injection; reuse that row.
      // A failed read leaves the tool off (fail closed).
      const featureUserEnabled = await isAgentSignalEnabledForUser(deps.db, deps.userId, {
        preference: await ctx.runFacts.userPreference().catch(() => undefined),
      });

      if (
        shouldExposeSelfFeedbackIntentTool({
          agentSelfIterationEnabled: featureUserEnabled,
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
    tools ??= [];
    for (const ft of functionTools) {
      tools.push({
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
