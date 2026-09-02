import type { AgentRuntimeContext } from '@lobechat/agent-runtime';
import { extractActivatedToolIdsFromMessages } from '@lobechat/agent-runtime';
import { builtinSkills } from '@lobechat/builtin-skills';
import { getShellSyntaxGuidance } from '@lobechat/builtin-tool-local-system';
import { builtinTools } from '@lobechat/builtin-tools';
import type { AgentManagementContext } from '@lobechat/context-engine';
import { buildExpertiseContextSnapshot, SkillEngine } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import { buildTaskManagerDefaultsPrompt, resourcesTreePrompt } from '@lobechat/prompts';
import type { LobeAgentAgencyConfig, WorkingDirConfig, WorkspaceInitResult } from '@lobechat/types';
import { getActivePluginIds, getWorkingDirEffectivePath } from '@lobechat/types';
import debug from 'debug';

import type { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { AiModelModel } from '@/database/models/aiModel';
import { DeviceModel } from '@/database/models/device';
import { ExpertiseModel } from '@/database/models/expertise';
import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { isDeviceCapablePlan } from '@/helpers/executionTarget';
import { shouldEnableBuiltinSkill } from '@/helpers/skillFilters';
import type { ServerUserMemoryConfig } from '@/server/modules/Mecha/ContextEngineering/types';
import type { AgentDocumentsService } from '@/server/services/agentDocuments';
import { deviceGateway } from '@/server/services/deviceGateway';
import { FileService } from '@/server/services/file';

import { pruneRegeneratedBranch } from '../pruneRegeneratedBranch';
import { resolveDeviceWorkingDirectoryConfig } from '../resolveDeviceWorkingDirectory';
import type { ExecRunContext, InternalExecAgentParams, ResolvedWorkspaceInit } from '../types';
import { isWorkspaceCacheFresh, upsertWorkspaceScan } from '../workspaceInitCache';
import type { ToolDiscoveryResult } from './toolDiscovery';
import type { RunAttachments } from './turnSetup';

const log = debug('lobe-server:ai-agent-service');

export interface HistoryLoaderInput {
  appContext?: InternalExecAgentParams['appContext'];
  effectiveResume: boolean;
  existingMessageIds: string[];
  parentMessageId?: string;
  resumeParentMessage: Awaited<ReturnType<MessageModel['findById']>>;
  selfMessageIds: Set<string>;
}

/**
 * Build the cached history loader shared by tool discovery (media-availability
 * probe) and the operation-prep message assembly. Loading is deferred and
 * cached so the run pays the query at most once.
 */
export const createHistoryMessagesLoader = (
  deps: { db: LobeChatDatabase; messageModel: MessageModel; userId: string; workspaceId?: string },
  input: HistoryLoaderInput,
): (() => Promise<any[]>) => {
  const {
    appContext,
    effectiveResume,
    existingMessageIds,
    parentMessageId,
    resumeParentMessage,
    selfMessageIds,
  } = input;

  // Resolve file URLs before visual tool activation checks and context build.
  const fileService = new FileService(deps.db, deps.userId, deps.workspaceId);
  const postProcessUrl = (path: string | null, file: { id?: string | null }) =>
    fileService.getFileAccessUrl({ id: file.id, url: path });
  let historyMessagesCache: any[] | undefined;

  return async () => {
    if (historyMessagesCache) return historyMessagesCache;

    if (existingMessageIds.length > 0) {
      const messages = await deps.messageModel.query(
        {
          sessionId: appContext?.sessionId,
          threadId: appContext?.threadId,
          topicId: appContext?.topicId ?? undefined,
        },
        { postProcessUrl },
      );
      const idSet = new Set(existingMessageIds);
      historyMessagesCache = messages.filter((msg) => idSet.has(msg.id));
    } else if (appContext?.topicId) {
      // Follow-up message in existing topic: load all history for context.
      // Exclude the turn we just persisted above (`selfMessageIds`) — history
      // must be the PRIOR turns only; the current prompt is appended separately
      // as the in-memory `userMessage`, so leaving it in would double-count it.
      const messages = await deps.messageModel.query(
        {
          sessionId: appContext?.sessionId,
          threadId: appContext?.threadId,
          topicId: appContext?.topicId,
        },
        { postProcessUrl },
      );
      historyMessagesCache = messages.filter((msg) => !selfMessageIds.has(msg.id));
    } else {
      historyMessagesCache = [];
    }

    // ── Regenerate: drop the anchor user message's existing answer branch ──
    // In gateway/server runtime mode the client only sends `parentMessageId`
    // (the user message being regenerated) and lets the server rebuild the
    // context. The topic query above still returns the anchor's *previous*
    // assistant branch (the answer being replaced) and — when a middle turn is
    // regenerated — the later turns that continued from it. Leaving them in
    // makes the model see an already-answered turn and "continue" it instead of
    // producing a fresh answer (`[U1, A1]` → continue rather than `[U1]` → A2).
    //
    // The branch must be pruned even after `/compact`: compaction hides the
    // grouped messages and `query` returns a synthetic `compressedGroup` node
    // that carries neither `parentId` nor (for compaction) the group's
    // `parentMessageId`, so ancestry can't be walked from `query` output alone.
    // We load the raw message tree (including hidden/compacted messages) and
    // compute the anchor's descendants from it, then drop both regular
    // descendant messages and any group node whose members fall in that branch.
    //
    // Scoped to a `user`-role anchor: the human-approval resume path anchors on
    // a tool message and must keep the in-flight turn (including parallel-tool
    // sibling messages) intact, so it is intentionally left untouched.
    if (
      historyMessagesCache &&
      effectiveResume &&
      parentMessageId &&
      resumeParentMessage?.role === 'user' &&
      appContext?.topicId
    ) {
      const tree = await deps.messageModel.queryTopicMessageTree({
        threadId: appContext.threadId,
        topicId: appContext.topicId,
      });
      historyMessagesCache = pruneRegeneratedBranch(historyMessagesCache, tree, parentMessageId);
    }

    return historyMessagesCache;
  };
};

export interface OperationPrepDeps {
  agentDocumentsService: AgentDocumentsService;
  agentModel: AgentModel;
  bindTopicWorkingDirectory: (params: {
    config?: WorkingDirConfig;
    currentWorkingDirectory?: string;
    topicId: string;
  }) => Promise<void>;
  db: LobeChatDatabase;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string;
}

export interface OperationPrepInput {
  botPlatformContext?: InternalExecAgentParams['botPlatformContext'];
  /** Tri-state disabled plugin identifiers — excluded from the skill pool. */
  disabledPluginIds: string[];
  discovery: ToolDiscoveryResult;
  ephemeralUserMessage?: string;
  globalMemoryEnabled: boolean;
  hasMentionedAgents: boolean;
  loadHistoryMessages: () => Promise<any[]>;
  mentionedAgents?: InternalExecAgentParams['mentionedAgents'];
  /** Deterministic continuation id or the freshly minted `op_…` id. */
  operationId: string;
  runAttachments: RunAttachments;
  runFromHistory: boolean;
  throwIfExecutionAborted: (stage: string) => Promise<void>;
}

export interface OperationPrepResult {
  activatableToolIds: string[];
  allMessages: any[];
  deviceSystemInfo: Record<string, string>;
  expertise?: Awaited<ReturnType<typeof buildExpertiseContextSnapshot>>;
  initialContext: AgentRuntimeContext;
  operationSkillSet?: ReturnType<SkillEngine['generate']>;
  userMemory?: ServerUserMemoryConfig;
}

/**
 * Resolve the "workspace init" scan (project skills + AGENTS.md) for a run
 * bound to a device's project directory. Reads the cache on
 * `devices.workingDirs[].workspace`, reusing it within the workspace-init TTL;
 * otherwise re-scans the device in one round-trip and writes the result back.
 *
 * Gated on `activeDeviceId` — without an online device there is nothing to
 * scan and no current working directory to key the cache on. The web UI reads
 * the same persisted `workingDirs` directly, so it can still render a last-known
 * scan even while the device is offline.
 */
const resolveWorkspaceInit = async (
  deps: OperationPrepDeps,
  params: {
    activeDeviceId: string | undefined;
    agencyConfig?: LobeAgentAgencyConfig;
    topicId: string;
  },
): Promise<ResolvedWorkspaceInit> => {
  const empty: WorkspaceInitResult = { instructions: [], skills: [] };
  const { activeDeviceId, agencyConfig, topicId } = params;
  if (!activeDeviceId) return { workspace: empty };

  try {
    // The active device may be personal (userId-scoped) or workspace-owned
    // (workspace-scoped) — look up both pools so the bound cwd, project
    // skills, and AGENTS/CLAUDE instructions still resolve for a workspace
    // device. Mirrors the dispatch-side lookup (see `deviceModelForCwd`).
    const deviceModel = new DeviceModel(deps.db, deps.userId, deps.workspaceId);
    const personalDevice = await deviceModel.findByDeviceId(activeDeviceId);
    const workspaceDevice = personalDevice
      ? undefined
      : await deviceModel.findWorkspaceDeviceById(activeDeviceId);
    const device = personalDevice ?? workspaceDevice;
    if (!device) return { workspace: empty };

    // For a workspace-owned device, route the gateway RPC to the
    // `workspace:<id>` principal and persist the scan via the workspace
    // update path — otherwise the scan goes through the personal pool
    // (empty result) and the writeback misses the row.
    const deviceWorkspaceId = workspaceDevice ? deps.workspaceId : undefined;

    // The bound project root we scan — resolved via the shared precedence
    // helper so it cannot drift from hetero dispatch / topic backfill. Read
    // from the persisted `device.defaultCwd` (not a live device query, which
    // only reports the daemon's process.cwd = `/`); also returned to the
    // caller so the system prompt's {{workingDirectory}} reflects the same
    // bound directory the workspace scan used.
    const topic = await deps.topicModel.findById(topicId);
    const topicWorkingDirectory = topic?.metadata?.workingDirectory;
    const boundCwdConfig = resolveDeviceWorkingDirectoryConfig({
      deviceDefaultCwd: device.defaultCwd,
      deviceId: activeDeviceId,
      topicWorkingDirectory,
      topicWorkingDirectoryConfig: topic?.metadata?.workingDirectoryConfig,
      workingDirByDevice: agencyConfig?.workingDirByDevice,
    });
    const boundCwd = getWorkingDirEffectivePath(boundCwdConfig);
    if (!boundCwd) return { workspace: empty };
    const resolved = { boundCwd, boundCwdConfig, topicWorkingDirectory };

    const workingDirs = device.workingDirs ?? [];
    const cached = workingDirs.find(
      (dir) => dir.path === boundCwd || getWorkingDirEffectivePath(dir) === boundCwd,
    );

    if (isWorkspaceCacheFresh(cached, Date.now()) && cached?.workspace) {
      log('execAgent: reusing cached workspace init for %s', boundCwd);
      return { ...resolved, workspace: cached.workspace };
    }

    const scanned = await deviceGateway.initWorkspace({
      deviceId: activeDeviceId,
      scope: boundCwd,
      userId: deps.userId,
      workspaceId: deviceWorkspaceId,
    });
    if (!scanned) {
      // Scan failed (offline mid-run / parse error). Fall back to a stale
      // cache rather than dropping the project's skills + instructions.
      if (cached?.workspace) {
        log('execAgent: workspace init scan failed, using stale cache for %s', boundCwd);
        return { ...resolved, workspace: cached.workspace };
      }
      return { ...resolved, workspace: empty };
    }

    // Persist the fresh scan back onto `workingDirs` (update in place or prepend
    // a new MRU entry), keeping the JSONB payload bounded. Workspace devices
    // are owned by the workspace, not a userId — use the workspace-scoped
    // update path so the writeback actually lands.
    //
    // Update the MATCHED entry's path, not `boundCwd`: the lookup above can
    // match a source entry by its effective (worktree) path, so a selected
    // worktree reaches here with `boundCwd` = the worktree path while the
    // recorded entry is keyed by the source path. Upserting on `boundCwd`
    // would prepend a bare worktree recent and lose the source/worktree
    // metadata the picker relies on; upsert on the matched source path instead.
    const updated = upsertWorkspaceScan(workingDirs, cached?.path ?? boundCwd, scanned, Date.now());
    if (deviceWorkspaceId) {
      await deviceModel.updateWorkspaceDevice(activeDeviceId, { workingDirs: updated });
    } else {
      await deviceModel.update(activeDeviceId, { workingDirs: updated });
    }
    log('execAgent: scanned and cached workspace init for %s', boundCwd);

    return { ...resolved, workspace: scanned };
  } catch (error) {
    log('execAgent: resolveWorkspaceInit failed: %O', error);
    return { workspace: empty };
  }
};

/**
 * Stages 9.4–18 of {@link AiAgentService.execAgent}: assemble everything
 * `createOperation` consumes beyond the tool set — device system info for
 * prompt placeholders, the agent-management context, user persona memory, the
 * message history + in-memory user message, the base initial runtime context
 * (active document / task manager / mentioned agents), the workspace-init scan
 * (bound cwd + project instructions), the OperationSkillSet, and the learned
 * expertise snapshot.
 *
 * Side effects, all order-preserving with the pre-extraction code: appends
 * project instructions to `ctx.agentConfig.systemRole`, writes the bound cwd
 * onto the returned `deviceSystemInfo`, pins the topic working directory, and
 * merges attachment warnings into `botPlatformContext`.
 */
export const prepareOperation = async (
  deps: OperationPrepDeps,
  ctx: ExecRunContext,
  input: OperationPrepInput,
): Promise<OperationPrepResult> => {
  const {
    agentConfig,
    appContext,
    assistantMessageId,
    model,
    parentMessageId,
    prompt,
    provider,
    resolvedAgentId,
    topicId,
    userMessageId,
  } = ctx;
  const {
    botPlatformContext,
    disabledPluginIds,
    discovery,
    ephemeralUserMessage,
    globalMemoryEnabled,
    hasMentionedAgents,
    loadHistoryMessages,
    mentionedAgents,
    operationId,
    runAttachments,
    runFromHistory,
    throwIfExecutionAborted,
  } = input;
  const {
    activeDeviceId,
    activeDeviceScope,
    agentPlugins,
    builtinModels,
    composioManifests,
    connectorManifests,
    executionPlan,
    lobehubSkillManifests,
    onlineDevices,
    toolsEngine,
    toolsResult,
    tools,
  } = discovery;

  // 9.4. Fetch device system info for placeholder variable replacement.
  //
  // Decoupled from activeDeviceId routing: pulled into a helper
  // so the device whose info populates the template (`{{hostname}}`,
  // `{{workingDirectory}}`, etc.) is a separate decision from the device
  // that tool calls route to. Today they're aligned — but future policy
  // changes (e.g., showing last-known info for an offline bound device)
  // belong in this helper, not in the activeDeviceId resolution block.
  const fetchDeviceSystemInfoForTemplate = async (
    deviceId: string | undefined,
  ): Promise<Record<string, string>> => {
    if (!deviceId) return {};
    try {
      // Scope the gateway lookup to the principal that owns the connection:
      // workspace devices need workspaceId; personal devices (including a
      // workspace run routed to the caller's own machine) must not.
      const systemInfo = await deviceGateway.queryDeviceSystemInfo(
        deps.userId,
        deviceId,
        activeDeviceScope === 'workspace' ? deps.workspaceId : undefined,
      );
      if (!systemInfo) return {};
      const device = onlineDevices.find((d) => d.deviceId === deviceId);
      log('execAgent: fetched device system info for %s', deviceId);
      // Devices that don't report defaultShell run an older client whose
      // runner still hardcodes cmd.exe on Windows — describe that honestly
      // instead of the new PowerShell default.
      const defaultShell =
        systemInfo.defaultShell ?? (device?.platform === 'win32' ? 'cmd.exe' : '/bin/sh');
      return {
        arch: systemInfo.arch,
        defaultShell,
        desktopPath: systemInfo.desktopPath,
        documentsPath: systemInfo.documentsPath,
        downloadsPath: systemInfo.downloadsPath,
        homePath: systemInfo.homePath,
        hostname: device?.hostname ?? 'unknown',
        musicPath: systemInfo.musicPath,
        picturesPath: systemInfo.picturesPath,
        platform: device?.platform ?? 'unknown',
        // Keep the syntax guidance consistent with the shell named above —
        // the system role references both placeholders in one sentence.
        shellSyntaxGuidance: getShellSyntaxGuidance(defaultShell),
        userDataPath: systemInfo.userDataPath,
        videosPath: systemInfo.videosPath,
        // `workingDirectory` is intentionally NOT taken from the live device
        // query — it only reports the daemon's process.cwd() (= `/` for a
        // Finder/Dock-launched app). The bound directory is resolved from the
        // persisted device row in resolveWorkspaceInit and written onto
        // deviceSystemInfo.workingDirectory at the call site below.
      };
    } catch (error) {
      log('execAgent: failed to fetch device system info: %O', error);
      return {};
    }
  };

  const deviceSystemInfo = await fetchDeviceSystemInfoForTemplate(activeDeviceId);

  // 9.5. Build Agent Management context
  // - availableAgents is injected whenever the user is in auto mode (so the supervisor
  //   can decide to activate agent-management on its own) OR when the tool is explicitly enabled.
  // - availableProviders / availablePlugins are only built when the tool is explicitly
  //   enabled, since they're solely needed for createAgent / updateAgent.
  const isAgentManagementEnabled = toolsResult.enabledToolIds?.includes('lobe-agent-management');
  const isInAutoSkillMode = agentConfig.chatConfig?.skillActivateMode !== 'manual';
  const shouldInjectAvailableAgents = isInAutoSkillMode || isAgentManagementEnabled;
  let agentManagementContext: AgentManagementContext | undefined;

  if (shouldInjectAvailableAgents) {
    // Query user's most recently updated agents.
    // Over-fetch by 2: +1 reserved for the current agent (filtered out below
    // so the model has no exposure to its own id and cannot self-delegate)
    // and +1 to detect overflow for the `hasMore` flag.
    const AVAILABLE_AGENTS_LIMIT = 10;
    const recentAgents = await deps.agentModel.queryAgents({
      limit: AVAILABLE_AGENTS_LIMIT + 2,
    });

    // Exclude the current agent from `availableAgents` — the model is the current
    // agent. Its persona/identity is already established by `systemRole`, so we
    // don't re-inject it here, and removing self from the list ensures the model
    // never sees its own id in the agent-management context (so it can't
    // accidentally call itself via `callAgent`).
    const otherAgents = recentAgents.filter((a) => a.id !== resolvedAgentId);
    const hasMoreAgents = otherAgents.length > AVAILABLE_AGENTS_LIMIT;
    const availableAgents = otherAgents.slice(0, AVAILABLE_AGENTS_LIMIT).map((a) => ({
      description: a.description ?? undefined,
      id: a.id,
      title: a.title ?? 'Untitled',
    }));

    agentManagementContext = {
      availableAgents,
      availableAgentsHasMore: hasMoreAgents,
      ...(resolvedAgentId && {
        currentAgent: {
          id: resolvedAgentId,
          title: agentConfig.title ?? undefined,
        },
      }),
    };
  }

  if (isAgentManagementEnabled) {
    // Query user's enabled models from database
    const aiModelModel = new AiModelModel(deps.db, deps.userId);
    const allUserModels = await aiModelModel.getAllModels();

    // Filter only enabled chat models and group by provider
    const providerMap = new Map<
      string,
      {
        id: string;
        models: Array<{ abilities?: any; description?: string; id: string; name: string }>;
        name: string;
      }
    >();

    for (const userModel of allUserModels) {
      // Only include enabled chat models
      if (!userModel.enabled || userModel.type !== 'chat') continue;

      // Get model info from builtin metadata for full metadata.
      const modelInfo = builtinModels.find(
        (m) => m.id === userModel.id && m.providerId === userModel.providerId,
      );

      if (!providerMap.has(userModel.providerId)) {
        providerMap.set(userModel.providerId, {
          id: userModel.providerId,
          models: [],
          name: userModel.providerId, // TODO: Map to friendly provider name
        });
      }

      const modelProvider = providerMap.get(userModel.providerId)!;
      modelProvider.models.push({
        abilities: userModel.abilities || modelInfo?.abilities,
        description: modelInfo?.description,
        id: userModel.id,
        name: userModel.displayName || modelInfo?.displayName || userModel.id,
      });
    }

    // Build availablePlugins from all plugin sources
    // Exclude only truly internal tools (agent-management itself, agent-builder, page-agent)
    const INTERNAL_TOOLS = new Set([
      'lobe-agent-management', // Don't show agent-management in its own context
      'lobe-agent-builder', // Used for editing current agent, not for creating new agents
      'lobe-group-agent-builder', // Used for editing current group, not for creating new agents
      'lobe-page-agent', // Page-editor specific tool
    ]);

    const availablePlugins = [
      // All builtin tools (including hidden ones like web-browsing, cloud-sandbox)
      ...builtinTools
        .filter((tool) => !INTERNAL_TOOLS.has(tool.identifier))
        .map((tool) => ({
          description: tool.manifest.meta?.description,
          identifier: tool.identifier,
          name: tool.manifest.meta?.title || tool.identifier,
          type: 'builtin' as const,
        })),
      // Lobehub Skills
      ...lobehubSkillManifests.map((manifest) => ({
        description: manifest.meta?.description,
        identifier: manifest.identifier,
        name: manifest.meta?.title || manifest.identifier,
        type: 'lobehub-skill' as const,
      })),
      // Composio tools
      ...composioManifests.map((manifest) => ({
        description: manifest.meta?.description,
        identifier: manifest.identifier,
        name: manifest.meta?.title || manifest.identifier,
        type: 'composio' as const,
      })),
      // Custom connectors (user-added MCP servers)
      ...connectorManifests.map((manifest) => ({
        description: manifest.meta?.description,
        identifier: manifest.identifier,
        name: manifest.meta?.title || manifest.identifier,
        type: 'custom' as const,
      })),
    ];

    // Merge models / plugins into the (already-initialized) agentManagementContext.
    // availableAgents was populated above by `shouldInjectAvailableAgents`, which is
    // always true when isAgentManagementEnabled.
    agentManagementContext = {
      ...agentManagementContext!,
      availablePlugins,
      // Limit to first 5 providers to avoid context bloat
      availableProviders: Array.from(providerMap.values()).slice(0, 5),
    };

    log(
      'execAgent: built agentManagementContext with %d providers, %d plugins, %d agents',
      agentManagementContext.availableProviders!.length,
      agentManagementContext.availablePlugins!.length,
      agentManagementContext.availableAgents?.length ?? 0,
    );
  } else if (agentManagementContext) {
    log(
      'execAgent: injected availableAgents only (auto mode, agent-management tool not enabled): %d agents',
      agentManagementContext.availableAgents?.length ?? 0,
    );
  }

  await throwIfExecutionAborted('tool preparation');

  // 10. Fetch user persona for memory injection (reuses globalMemoryEnabled from step 8)
  let userMemory: ServerUserMemoryConfig | undefined;

  if (globalMemoryEnabled) {
    try {
      const personaModel = new UserPersonaModel(deps.db, deps.userId);
      const persona = await personaModel.getLatestPersonaDocument();

      if (persona?.persona) {
        userMemory = {
          fetchedAt: Date.now(),
          memories: {
            contexts: [],
            experiences: [],
            persona: {
              narrative: persona.persona,
              tagline: persona.tagline,
            },
            preferences: [],
          },
        };
        log('execAgent: fetched user persona (version: %d)', persona.version);
      }
    } catch (error) {
      log('execAgent: failed to fetch user persona: %O', error);
    }
  }

  // 11. Get existing messages if provided.
  const historyMessages = await loadHistoryMessages();

  await throwIfExecutionAborted('message history loading');

  // 12. Surface Phase 2 warnings (attachment ingestion/parsing errors) from the
  // shared turn-setup block to the context engine, alongside Phase 1 warnings
  // already on botPlatformContext. The DB user/assistant rows + Agent Signal
  // enqueue all happened in that shared block, before the hetero fork.
  if (runAttachments.warnings.length > 0 && botPlatformContext) {
    const existing = (botPlatformContext as any).warnings as string[] | undefined;
    (botPlatformContext as any).warnings = [...(existing ?? []), ...runAttachments.warnings];
  }

  // Build the in-memory user message for the LLM context (separate from the DB
  // row created above).
  // - imageList: vision models render these as image_url parts
  // - videoList: video-capable models render these as video parts
  // - audioList: audio-capable models render these as audio parts
  // - fileList: MessageContentProcessor injects content via filesPrompts() XML
  const userMessage = {
    audioList: runAttachments.audioList,
    content: ephemeralUserMessage ?? prompt,
    fileList: runAttachments.fileList,
    id: userMessageId,
    imageList: runAttachments.imageList,
    role: 'user' as const,
    videoList: runAttachments.videoList,
  };

  // Combine history messages with the user message. An ephemeral message is
  // injected into the LLM context even under runFromHistory (suppressUserMessage)
  // — it drives this turn but was never persisted (id is undefined).
  const allMessages =
    runFromHistory && !ephemeralUserMessage ? historyMessages : [...historyMessages, userMessage];

  // Re-check historical activations against this run's tool-mode and model
  // gates. manifestMap is intentionally broader for discovery and must not
  // by itself authorize a tool in chat/custom mode or without function calls.
  const historicalActivatedToolIds = extractActivatedToolIdsFromMessages(allMessages) ?? [];
  const activatableToolIds =
    toolsEngine && historicalActivatedToolIds.length > 0
      ? toolsEngine.generateToolsDetailed({
          context: { isExplicitActivation: true },
          model,
          provider,
          skipDefaultTools: true,
          toolIds: historicalActivatedToolIds,
        }).enabledToolIds
      : [];

  log('execAgent: prepared evalContext for executor');

  await throwIfExecutionAborted('operation preparation');

  // 16. Create initial context
  let initialContext: AgentRuntimeContext = {
    payload: {
      // Pass assistant message ID so agent runtime knows which message to update
      assistantMessageId,
      isFirstMessage: true,
      message:
        runFromHistory && !ephemeralUserMessage
          ? [{ content: '' }]
          : [{ content: ephemeralUserMessage ?? prompt }],
      // Pass user message ID as parentMessageId for reference
      parentMessageId: parentMessageId ?? userMessageId ?? '',
      // Include tools for initial LLM call
      tools,
    },
    phase: 'user_input' as const,
    session: {
      messageCount: allMessages.length,
      sessionId: operationId,
      status: 'idle' as const,
      stepCount: 0,
    },
  };

  if (appContext?.scope !== 'page' && appContext?.documentId) {
    // Server is authoritative — `(agentId, documentId)` is a unique binding
    // so a single indexed lookup both validates any caller-supplied
    // `agentDocumentId` hint and resolves the row id when one was not
    // provided (covers docs opened outside the active topic, e.g. skills
    // and web docs).
    try {
      const row = await deps.agentDocumentsService.findRowByDocumentId(
        resolvedAgentId,
        appContext.documentId,
      );

      initialContext = {
        ...initialContext,
        initialContext: {
          activeTopicDocument: {
            ...(row?.id ? { agentDocumentId: row.id } : {}),
            documentId: appContext.documentId,
            ...(row?.title ? { title: row.title } : {}),
          },
        },
      };
    } catch (error) {
      log('execAgent: failed to resolve active topic document context: %O', error);
      initialContext = {
        ...initialContext,
        initialContext: {
          activeTopicDocument: {
            documentId: appContext.documentId,
          },
        },
      };
    }
  }

  if (appContext?.scope === 'task' && appContext.defaultTaskAssigneeAgentId) {
    initialContext = {
      ...initialContext,
      initialContext: {
        ...initialContext.initialContext,
        taskManager: {
          contextPrompt: buildTaskManagerDefaultsPrompt({
            defaultAssigneeAgentId: appContext.defaultTaskAssigneeAgentId,
          }),
        },
      },
    };
  }

  // Persist the @-mentioned agents into the runtime initialContext so the
  // context engine injects the delegation context on every step (survives the
  // queue-mode dispatch). `callLlm` bridges this into `agentManagementContext`
  // for the AgentManagementContextInjector — mirrors the client runtime.
  if (hasMentionedAgents) {
    initialContext = {
      ...initialContext,
      initialContext: {
        ...initialContext.initialContext,
        mentionedAgents,
      },
    };
  }

  // Project skills + the root AGENTS.md are discovered server-side by
  // scanning the device's bound project directory ("workspace init"), cached
  // on `devices.workingDirs` and reused within the TTL. Skills surface in
  // `<available_skills>` (metadata only — SKILL.md bodies are read lazily at
  // activation via `local-system` readFile, which `serverRuntimes/skills.ts`
  // re-gates on `activeDeviceId`). Only `location` (the absolute SKILL.md
  // path) flows through; the directory tree is enumerated lazily, keeping the
  // op-param payload small.
  const workspaceInit = await resolveWorkspaceInit(deps, {
    activeDeviceId,
    agencyConfig: agentConfig.agencyConfig ?? undefined,
    topicId,
  });

  // Feed the bound directory (resolved from the persisted device row) into
  // the local-system tool's {{workingDirectory}} placeholder — the channel
  // the model uses to know where it is and reach for absolute paths — and,
  // downstream, the runCommand cwd / search scope (RuntimeExecutors reads
  // state.metadata.deviceSystemInfo.workingDirectory). Resume-safe via the
  // existing deviceSystemInfo plumbing (computeDeviceContext).
  if (workspaceInit.boundCwd) {
    deviceSystemInfo.workingDirectory = workspaceInit.boundCwd;
  }

  // Bind the topic to that very directory. A native (non-hetero) agent
  // routed to a device used to resolve its cwd here for the prompt and the
  // tools, but never write it back — so its topics stayed unbound while the
  // run itself executed in the right place. Awaited (not fire-and-forget):
  // the tool layer reads the topic's cwd on the same run.
  await deps.bindTopicWorkingDirectory({
    config: workspaceInit.boundCwdConfig,
    currentWorkingDirectory: workspaceInit.topicWorkingDirectory,
    topicId,
  });

  // 18. Build OperationSkillSet via SkillEngine
  // Combines builtin skills + user DB skills + agent-document skill bundles,
  // filters by platform via enableChecker, and pairs with agent's enabled
  // plugin IDs for downstream SkillResolver consumption.
  let operationSkillSet;
  try {
    const builtinMetas = builtinSkills.map((s) => ({
      content: s.content,
      description: s.description,
      identifier: s.identifier,
      name: s.name,
    }));
    const skillModel = new AgentSkillModel(deps.db, deps.userId, deps.workspaceId);
    const { data: dbSkills } = await skillModel.findAll();

    // Pinned skills need their SKILL.md body injected into context directly,
    // not lazily via the `activateSkill` tool. Gate on the agent's genuinely
    // pinned entries (`getActivePluginIds(agentConfig.plugins)`), NOT the
    // fully-expanded `agentPlugins`: the latter also carries turn-scoped tool
    // ids (mentions, selected tools, `lobe-topic-reference`, …), which would
    // eager-activate an auto-mode skill whose identifier merely collides with
    // one of them. `findAll` uses `skillListColumns` (no `content`), so fetch
    // bodies only for the pinned subset to keep the op-param payload bounded.
    // Non-pinned skills stay content-less here and remain lazily activatable.
    // Content lives in the DB `content` column already (SKILL.md body), so no
    // zip unpack is needed; mirror `activateSkill` by appending the resource
    // tree so pinned ZIP/GitHub skills keep their `readReference` paths.
    const pinnedSkillIds = new Set(getActivePluginIds(agentConfig.plugins));
    const pinnedDbSkillIds = dbSkills
      .filter((s) => pinnedSkillIds.has(s.identifier))
      .map((s) => s.id);
    const pinnedDbContent = new Map(
      (await skillModel.findByIds(pinnedDbSkillIds)).map((s) => {
        const hasResources = !!(s.resources && Object.keys(s.resources).length > 0);
        const content =
          hasResources && s.resources
            ? `${s.content ?? ''}\n\n${resourcesTreePrompt(s.name, s.resources)}`
            : (s.content ?? undefined);
        return [s.identifier, content] as const;
      }),
    );
    const dbMetas = dbSkills.map((s) => ({
      content: pinnedDbContent.get(s.identifier),
      description: s.description ?? '',
      identifier: s.identifier,
      name: s.name,
    }));

    // Agent-document skill bundles surfaced as runtime skills via the shared
    // `getAgentSkills` source of truth (prefix + index-child resolution lives
    // there; see `AgentDocumentsService.getAgentSkills`). Identifier is
    // prefixed (`agent-skills:<filename>`) so it can't collide with builtin
    // / DB skill names, and we re-use it as `name` so the prompt's
    // `<skill name="...">` line and the model's `activateSkill(name)` call
    // carry the same value.
    const agentSkills = await deps.agentDocumentsService.getAgentSkills(resolvedAgentId);
    const agentSkillMetas = agentSkills.map((skill) => ({
      // `getAgentSkills` already resolves the bundle body, so pinned
      // agent-document skills inject directly without an extra fetch; only
      // attach it for the pinned subset to keep the payload lean.
      content: pinnedSkillIds.has(skill.identifier) ? skill.content : undefined,
      description: skill.description,
      identifier: skill.identifier,
      name: skill.name,
    }));

    const projectMetas = workspaceInit.workspace.skills.map((s) => ({
      description: s.description ?? '',
      identifier: `${s.scope === 'device' ? 'device' : 'project'}:${s.name}`,
      location: s.path,
      name: s.name,
      source: s.scope === 'device' ? ('device' as const) : ('project' as const),
    }));

    if (projectMetas.length) {
      log(
        'execAgent: workspace skills merged: %d (activeDeviceId=%s)',
        projectMetas.length,
        activeDeviceId ?? 'none',
      );
    }

    // Inject the project-root agent instructions (AGENTS.md / CLAUDE.md) as
    // trailing blocks on the system role — after the agent's persona and any
    // page/task/additional instructions. `agentConfig` is read by
    // `createOperation` below, so appending here still reaches the LLM.
    if (workspaceInit.workspace.instructions.length) {
      const block = workspaceInit.workspace.instructions
        .map(
          ({ content, source }) =>
            `<project_instructions source="${source}">\n${content}\n</project_instructions>`,
        )
        .join('\n\n');
      agentConfig.systemRole = agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${block}`
        : block;
      log(
        'execAgent: injected %d project instruction file(s): %s',
        workspaceInit.workspace.instructions.length,
        workspaceInit.workspace.instructions.map((i) => i.source).join(', '),
      );
    }

    // Precedence on name collision: project > db > agent-skills > builtin.
    // Agent-skills carry the `agent-skills:` prefix in their `name`, so they
    // can only collide with each other — but we still dedupe by name to keep
    // a single shape for the SkillEngine input.
    //
    // Disabled skills are dropped here, not just rule-gated later: this
    // `skills` array is the sole candidate pool SkillEngine/SkillResolver
    // build `<available_skills>` from AND the pool `activateSkill` resolves
    // against, so a disabled identifier absent here is neither listed nor
    // activatable — mirrors the tool-manifest treatment above (installedPlugins/
    // additionalManifests), which this array had never received.
    const seenNames = new Set<string>();
    const skills = [...projectMetas, ...dbMetas, ...agentSkillMetas, ...builtinMetas].filter(
      (skill) => {
        if (disabledPluginIds.includes(skill.identifier)) return false;
        if (seenNames.has(skill.name)) return false;
        seenNames.add(skill.name);
        return true;
      },
    );

    // Device-only builtin skills (agent-browser) are gated on the run's
    // execution plan, not the compile-time `isDesktop` constant (always false
    // on the server). Gate the static `<available_skills>` listing on the
    // device-CAPABLE plan rather than `activeDeviceId`: `device-unrouted`
    // runs let the model pick a device mid-run, and this skill set is built
    // once per operation — gating on `activeDeviceId` would hide the skill
    // forever in those runs. Activation/loading apply the same plan gate via
    // `ToolExecutionContext.deviceCapable`; only actual command execution is
    // gated at the device tool layer.
    const skillEngine = new SkillEngine({
      enableChecker: (skill) =>
        shouldEnableBuiltinSkill(skill.identifier, {
          canExecuteOnDevice: executionPlan ? isDeviceCapablePlan(executionPlan) : false,
        }),
      skills,
    });
    operationSkillSet = skillEngine.generate(agentPlugins ?? []);
  } catch (error) {
    log('execAgent: failed to build operationSkillSet: %O', error);
  }

  // Resolve learned expertise once so every step in this operation uses the exact same snapshot.
  // ContextEngine owns the Lab-controlled injection decision via enableExpertise.
  const expertiseAgentId = appContext?.agentSignal?.agentId ?? resolvedAgentId;
  let expertise;
  try {
    const expertiseModel = new ExpertiseModel(deps.db, deps.userId, deps.workspaceId);
    expertise = await buildExpertiseContextSnapshot(expertiseModel, expertiseAgentId);
  } catch (error) {
    console.error('Failed to build expertise snapshot for agent:', expertiseAgentId, error);
  }

  return {
    activatableToolIds,
    allMessages,
    deviceSystemInfo,
    expertise,
    initialContext,
    operationSkillSet,
    userMemory,
  };
};
