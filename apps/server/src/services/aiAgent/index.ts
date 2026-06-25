import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { BUILTIN_AGENT_SLUGS, getAgentRuntimeConfig } from '@lobechat/builtin-agents';
import { builtinSkills } from '@lobechat/builtin-skills';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { LobeAgentIdentifier, LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import type { DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import { generateSystemPrompt, RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import {
  injectSelfFeedbackIntentTool,
  shouldExposeSelfFeedbackIntentTool,
} from '@lobechat/builtin-tool-self-iteration';
import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { builtinTools, manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import { LOADING_FLAT } from '@lobechat/const';
import type {
  AgentManagementContext,
  BotPlatformContext,
  LobeToolManifest,
  ToolExecutor,
  ToolSource,
} from '@lobechat/context-engine';
import { SkillEngine } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { buildTaskManagerDefaultsPrompt } from '@lobechat/prompts';
import type {
  ChatAudioItem,
  ChatFileItem,
  ChatTopicBotContext,
  ChatVideoItem,
  ExecAgentParams,
  ExecAgentResult,
  ExecGroupAgentParams,
  ExecGroupAgentResult,
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
  LobeAgentAgencyConfig,
  MessagePluginItem,
  UserInterventionConfig,
  WorkspaceInitResult,
} from '@lobechat/types';
import { buildHeteroExecArgs, RequestTrigger, ThreadStatus, ThreadType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { AiModelModel } from '@/database/models/aiModel';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { DeviceModel } from '@/database/models/device';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TaskModel } from '@/database/models/task';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { toolsEnv } from '@/envs/tools';
import {
  type ExecutionPlan,
  executionTargetToRuntimeMode,
  isDeviceCapablePlan,
  resolveExecutionPlan,
} from '@/helpers/executionTarget';
import { shouldEnableBuiltinSkill } from '@/helpers/skillFilters';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { signOperationJwt, signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type { EvalContext, ServerAgentToolsContext } from '@/server/modules/Mecha';
import { createServerAgentToolsEngine } from '@/server/modules/Mecha';
import type { ServerUserMemoryConfig } from '@/server/modules/Mecha/ContextEngineering/types';
import { AgentService } from '@/server/services/agent';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import type {
  AgentExecutionParams,
  AgentExecutionResult,
  AgentRuntimeServiceOptions,
  SubAgentBridgeParams,
} from '@/server/services/agentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { getAbortError, isAbortError, throwIfAborted } from '@/server/services/agentRuntime/abort';
import { dispatchTerminalHooks, hookDispatcher } from '@/server/services/agentRuntime/hooks';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import type {
  ExecGroupMemberParams,
  ExecGroupMemberResult,
  GroupActionMemberBridgeParams,
  GroupActionMemberMode,
  GroupActionOnComplete,
  StepLifecycleCallbacks,
} from '@/server/services/agentRuntime/types';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import {
  isAgentSignalEnabledForUser,
  isLobeAiAgentSlug,
  resolveAgentSelfIterationCapability,
} from '@/server/services/agentSignal/featureGate';
import { shouldSuppressSignal } from '@/server/services/agentSignal/suppressSignal';
import { ComposioService } from '@/server/services/composio';
import { deviceGateway } from '@/server/services/deviceGateway';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { resolveAttachmentsByFileIds } from '@/server/services/file/resolveAttachments';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';
import type { ConversationHistoryEntry } from '@/server/services/heterogeneousAgent/cloudHeteroContext';
import { MarketService } from '@/server/services/market';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { resolveDeviceAccessPolicy } from './deviceAccessPolicy';
import { buildAllowedBuiltinTools, isDeviceToolIdentifier } from './deviceToolRegistry';
import { ingestAttachment } from './ingestAttachment';
import { resolveDeviceWorkingDirectory } from './resolveDeviceWorkingDirectory';
import { isWorkspaceCacheFresh, upsertWorkspaceScan } from './workspaceInitCache';

const log = debug('lobe-server:ai-agent-service');

/**
 * Format error for storage in thread metadata
 * Handles Error objects which don't serialize properly with JSON.stringify
 */
function formatErrorForMetadata(error: unknown): Record<string, any> | undefined {
  if (!error) return undefined;

  // Handle Error objects
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  // Handle objects with message property (like ChatMessageError)
  if (typeof error === 'object' && 'message' in error) {
    return error as Record<string, any>;
  }

  // Fallback: wrap in object
  return { message: String(error) };
}

const getVisualAvailabilityFromFileTypes = (fileTypes: string[]) => ({
  hasImages: fileTypes.some((fileType) => fileType.startsWith('image')),
  hasVideos: fileTypes.some((fileType) => fileType.startsWith('video')),
});

interface VisualAvailabilityMessage {
  imageList?: unknown[];
  role?: string;
  videoList?: unknown[];
}

const getVisualAvailabilityFromMessages = (messages: VisualAvailabilityMessage[]) => ({
  hasImages: messages.some(
    (message) => message.role === 'user' && (message.imageList?.length ?? 0) > 0,
  ),
  hasVideos: messages.some(
    (message) => message.role === 'user' && (message.videoList?.length ?? 0) > 0,
  ),
});

const isVisualUnderstandingConfigured = () => {
  try {
    return !!toolsEnv.VISUAL_UNDERSTANDING_PROVIDER && !!toolsEnv.VISUAL_UNDERSTANDING_MODEL;
  } catch {
    // The env proxy rejects server-only keys in client-like runtimes; treat that as disabled.
    return false;
  }
};

/**
 * Internal params for execAgent with step lifecycle callbacks
 * This extends the public ExecAgentParams with server-side only options
 */
interface InternalExecAgentParams extends ExecAgentParams {
  /** Additional plugin IDs to inject (e.g., task tool during task execution) */
  additionalPluginIds?: string[];
  /** Bot context for topic metadata (platform, applicationId, platformThreadId) */
  botContext?: ChatTopicBotContext;
  /** Bot platform context for injecting platform capabilities (e.g. markdown support) */
  botPlatformContext?: BotPlatformContext;
  /** Cron job ID that triggered this execution (if trigger is 'cron') */
  cronJobId?: string;
  /** Disable only local-system while preserving other tools. Useful for signal-only evals. */
  disableLocalSystem?: boolean;
  /** Disable the self-iteration declaration tool for reviewer/runtime paths. */
  disableSelfFeedbackIntentTool?: boolean;
  /** Disable all tools (no plugins, no system manifests). Useful for eval/benchmark scenarios. */
  disableTools?: boolean;
  /** Discord context for injecting channel/guild info into agent system message */
  discordContext?: any;
  /**
   * Inject a user-role message into the LLM context for this turn WITHOUT
   * persisting it (no DB row, no Agent Signal). Used for ephemeral orchestration
   * instructions — e.g. a group supervisor's `<speaker>` instruction to a member —
   * so it drives the member's response without polluting the group conversation.
   * Requires `suppressUserMessage` (the turn runs off existing history).
   */
  ephemeralUserMessage?: string;
  /** Eval context for injecting environment prompts into system message */
  evalContext?: EvalContext;
  /** External files to upload to S3 and attach to the user message */
  files?: Array<{
    /** Pre-downloaded buffer (from adapter/platform layer) */
    buffer?: Buffer;
    mimeType?: string;
    name?: string;
    size?: number;
    /** External URL — fetched if no buffer provided */
    url?: string;
  }>;
  /** Client-side function tools from Response API — injected into LLM with source='client' */
  functionTools?: Array<{ description?: string; name: string; parameters?: Record<string, any> }>;
  /** External lifecycle hooks (auto-adapt to local/production mode) */
  hooks?: AgentHook[];
  /** Initial step count offset for resumed operations (accumulated from previous runs) */
  initialStepCount?: number;
  /** Maximum steps for the agent operation */
  maxSteps?: number;
  /** Parent message ID to continue from. Only takes effect when resume is true */
  parentMessageId?: string;
  queueRetries?: number;
  queueRetryDelay?: string;
  /** Whether to continue execution from an existing persisted message */
  resume?: boolean;
  /**
   * When present, this execAgent call acts as the "continue" step for a
   * previous op that hit `human_approve_required`. The service writes the
   * decision to the target tool message and either runs the approved tool
   * (`approved`), halts with `reason='human_rejected'` (`rejected`), or
   * surfaces the rejection as user feedback so the LLM can respond
   * (`rejected_continue`). `parentMessageId` must point at the pending tool
   * message.
   */
  resumeApproval?: {
    decision: 'approved' | 'rejected' | 'rejected_continue';
    parentMessageId: string;
    rejectionReason?: string;
    toolCallId: string;
  };
  /** Abort startup before the agent runtime operation is created */
  signal?: AbortSignal;
  /**
   * Whether the LLM call should use streaming.
   * Defaults to true. Set to false for non-streaming scenarios (e.g., bot integrations).
   */
  stream?: boolean;
  /**
   * Run the turn off existing topic history without injecting a new user message
   * (no user-message row, no Agent Signal source event). The agent responds to
   * whatever the context engine surfaces as the latest turn. Used by auto-repair,
   * where the failure feedback already lives on the verify card in history.
   * `prompt` is still used for the operation title / logs. Unlike `resume`, this
   * starts a fresh operation and skips the resume-specific validation.
   */
  suppressUserMessage?: boolean;
  /** Task ID that triggered this execution (if trigger is 'task') */
  taskId?: string;
  /**
   * Custom title for the topic.
   * When provided (including empty string), overrides the default prompt-based title.
   * When undefined, falls back to prompt.slice(0, 50).
   */
  title?: string;
  /** Topic creation trigger source ('cron' | 'chat' | 'api' | 'task') */
  trigger?: string;
  /**
   * User intervention configuration
   * Use { approvalMode: 'headless' } for async tasks that should never wait for human approval
   */
  userInterventionConfig?: UserInterventionConfig;
}

/**
 * Result of {@link AiAgentService.resolveWorkspaceInit}: the cacheable scan
 * (`workspace`) plus the per-run resolved bound directory (`boundCwd`).
 *
 * `boundCwd` is deliberately kept OUT of {@link WorkspaceInitResult}: that type
 * is persisted into `devices.workingDirs[].workspace` and read by the web UI,
 * and its scanned root is always the enclosing `WorkingDirEntry.path` — not a
 * field on the scan. Surfacing it here lets the caller fill the system prompt's
 * `{{workingDirectory}}` (and the tool cwd/scope downstream) without re-loading
 * the device + topic the scan already read.
 */
interface ResolvedWorkspaceInit {
  boundCwd?: string;
  workspace: WorkspaceInitResult;
}

/**
 * AI Agent Service
 *
 * Encapsulates agent execution logic that can be triggered via:
 * - tRPC router (aiAgent.execAgent)
 * - REST API endpoint (/api/agent)
 * - Cron jobs / scheduled tasks
 */
export class AiAgentService {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly agentDocumentsService: AgentDocumentsService;
  private readonly agentModel: AgentModel;
  private readonly agentOperationModel: AgentOperationModel;
  private readonly agentService: AgentService;
  private readonly messageModel: MessageModel;
  private readonly connectorModel: ConnectorModel;
  private readonly connectorToolModel: ConnectorToolModel;
  private readonly pluginModel: PluginModel;
  private readonly taskModel: TaskModel;
  private readonly threadModel: ThreadModel;
  private readonly topicModel: TopicModel;
  private readonly agentRuntimeService: AgentRuntimeService;
  private readonly marketService: MarketService;
  private readonly composioService: ComposioService;

  private readonly workspaceId?: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options?: { runtimeOptions?: AgentRuntimeServiceOptions; workspaceId?: string },
  ) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = options?.workspaceId;
    const wsId = this.workspaceId;
    this.agentDocumentsService = new AgentDocumentsService(db, userId, wsId);
    this.agentModel = new AgentModel(db, userId, wsId);
    this.agentOperationModel = new AgentOperationModel(db, userId, wsId);
    this.agentService = new AgentService(db, userId, wsId);
    this.messageModel = new MessageModel(db, userId, wsId);
    this.connectorModel = new ConnectorModel(db, userId, wsId);
    this.connectorToolModel = new ConnectorToolModel(db, userId, wsId);
    this.pluginModel = new PluginModel(db, userId, wsId);
    this.taskModel = new TaskModel(db, userId, wsId);
    this.threadModel = new ThreadModel(db, userId, wsId);
    this.topicModel = new TopicModel(db, userId, wsId);
    this.agentRuntimeService = new AgentRuntimeService(db, userId, {
      ...options?.runtimeOptions,
      // ── Runtime delegate ─────────────────────────────────────────────────
      // Operations the runtime delegates back UP to this layer. The dependency
      // arrow is one-way (AiAgentService → AgentRuntimeService), so the runtime
      // can't import us; instead we hand it the callbacks it needs to trigger
      // high-level pipelines mid-step. See AgentRuntimeDelegate. New high-level
      // capabilities the runtime calls into go in this `delegate` object.
      //
      // Arrow fields are auto-bound, so no `.bind(this)`.
      delegate: {
        execSubAgent: this.execSubAgent,
        execVirtualSubAgent: this.execVirtualSubAgent,
        execGroupMember: this.execGroupMember,
      },
      workspaceId: wsId,
    });
    this.marketService = new MarketService({ userInfo: { userId } });
    this.composioService = new ComposioService({ db, userId });
  }

  private async resolveOperationTaskId(
    idOrIdentifier?: string | null,
  ): Promise<string | undefined> {
    if (!idOrIdentifier) return;

    // Task detail routes use human-readable identifiers such as `T-1`, while
    // operation runtimes store this value in FK-backed records.
    const task = await this.taskModel.resolve(idOrIdentifier);
    return task?.id;
  }

  /**
   * If `deviceId` is a device enrolled into the caller's current workspace,
   * return that workspaceId so device-gateway calls route to the
   * `workspace:<id>` principal. Returns undefined for a personal device (or no
   * workspace context), keeping the personal path byte-identical.
   */
  private async resolveDeviceWorkspaceId(
    deviceId: string | undefined,
  ): Promise<string | undefined> {
    if (!deviceId || !this.workspaceId) return undefined;
    const row = await new DeviceModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findWorkspaceDeviceById(deviceId);
    return row ? this.workspaceId : undefined;
  }

  /**
   * Finalize a hetero run that fails *synchronously at dispatch* — before the
   * CLI/agent process ever starts (device offline → DEVICE_NOT_FOUND, no bound
   * device, access denied, sandbox spawn rejected). These paths never produce a
   * `heteroFinish` (CLI exit) or `agentNotify` done callback, so without this
   * each one would strand the run: the assistant bubble would show an error but
   * the UI stream would never close and a long-run task would hang in `running`.
   *
   * Routes through the SAME terminal funnel a normal exit uses — it fires the
   * run's onComplete/onError hooks via `dispatchTerminalHooks`, so the task
   * lifecycle (onTopicComplete → task failed) and any IM bot completion callback
   * fire exactly as they would for a real failure — then closes the UI stream and
   * clears the (never-started) running operation. The hooks were registered and
   * serialized onto `runningOperation` at dispatch time.
   *
   * Stream-close / hook dispatch / metadata clear are best-effort: a failure
   * there must not mask the original dispatch error the caller surfaces.
   */
  private async finalizeHeteroDispatchError(params: {
    agentId?: string;
    assistantMessageId: string;
    detail: string;
    message: string;
    operationId: string;
    topicId: string;
  }): Promise<void> {
    const { agentId, assistantMessageId, detail, message, operationId, topicId } = params;

    // 1. Error bubble — written first so a stream subscriber reacting to the
    //    end event below re-reads a message that already carries the error.
    await this.messageModel.update(assistantMessageId, {
      content: '',
      error: { body: { detail }, message, type: 'ServerAgentRuntimeError' },
    });

    // 1b. Mark the agent_operations row terminal. The row was inserted at
    //     recordStart, but a dispatch failure goes through THIS path, not
    //     heteroFinish — so without this the row stays status='running' forever
    //     and pollutes operation-lifecycle / verify views for failed starts.
    try {
      await this.agentOperationModel.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'error',
        error: { message, type: 'ServerAgentRuntimeError' },
        status: 'error',
      });
    } catch (err) {
      log('finalizeHeteroDispatchError: recordCompletion failed (non-fatal): %O', err);
    }

    // 2. Close the UI stream.
    try {
      await createStreamEventManager().publishAgentRuntimeEnd({
        finalState: { error: detail },
        operationId,
        reason: 'error',
        reasonDetail: detail,
        stepIndex: 0,
      });
    } catch (err) {
      log('finalizeHeteroDispatchError: publishAgentRuntimeEnd failed (non-fatal): %O', err);
    }

    // 3. Fire onComplete/onError hooks (task lifecycle + bot callback). Hooks
    //    were registered in-memory (local mode) and serialized onto
    //    runningOperation (queue mode) at dispatch time.
    await dispatchTerminalHooks({
      agentId,
      errorMessage: message,
      errorType: 'ServerAgentRuntimeError',
      operationId,
      reason: 'error',
      serializedHooks: hookDispatcher.getSerializedHooks(operationId),
      topicId,
      userId: this.userId,
    });

    // 4. The operation never started — drop the running marker so reconnect /
    //    heteroIngest validation and the next turn don't see a stale operation.
    try {
      await this.topicModel.updateMetadata(topicId, { runningOperation: null });
    } catch (err) {
      log('finalizeHeteroDispatchError: clear runningOperation failed (non-fatal): %O', err);
    }
  }

  /**
   * Resolve the "workspace init" scan (project skills + AGENTS.md) for a run
   * bound to a device's project directory. Reads the cache on
   * `devices.workingDirs[].workspace`, reusing it within {@link WORKSPACE_INIT_TTL_MS};
   * otherwise re-scans the device in one round-trip and writes the result back.
   *
   * Gated on `activeDeviceId` — without an online device there is nothing to
   * scan and no current working directory to key the cache on. The web UI reads
   * the same persisted `workingDirs` directly, so it can still render a last-known
   * scan even while the device is offline.
   */
  private async resolveWorkspaceInit(params: {
    activeDeviceId: string | undefined;
    agencyConfig?: LobeAgentAgencyConfig;
    topicId: string;
  }): Promise<ResolvedWorkspaceInit> {
    const empty: WorkspaceInitResult = { instructions: [], skills: [] };
    const { activeDeviceId, agencyConfig, topicId } = params;
    if (!activeDeviceId) return { workspace: empty };

    try {
      // The active device may be personal (userId-scoped) or workspace-owned
      // (workspace-scoped) — look up both pools so the bound cwd, project
      // skills, and AGENTS/CLAUDE instructions still resolve for a workspace
      // device. Mirrors the dispatch-side lookup (see `deviceModelForCwd`).
      const deviceModel = new DeviceModel(this.db, this.userId, this.workspaceId);
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
      const deviceWorkspaceId = workspaceDevice ? this.workspaceId : undefined;

      // The bound project root we scan — resolved via the shared precedence
      // helper so it cannot drift from hetero dispatch / topic backfill. Read
      // from the persisted `device.defaultCwd` (not a live device query, which
      // only reports the daemon's process.cwd = `/`); also returned to the
      // caller so the system prompt's {{workingDirectory}} reflects the same
      // bound directory the workspace scan used.
      const topic = await this.topicModel.findById(topicId);
      const boundCwd = resolveDeviceWorkingDirectory({
        deviceDefaultCwd: device.defaultCwd,
        deviceId: activeDeviceId,
        topicWorkingDirectory: topic?.metadata?.workingDirectory,
        workingDirByDevice: agencyConfig?.workingDirByDevice,
      });
      if (!boundCwd) return { workspace: empty };

      const workingDirs = device.workingDirs ?? [];
      const cached = workingDirs.find((dir) => dir.path === boundCwd);

      if (isWorkspaceCacheFresh(cached, Date.now()) && cached?.workspace) {
        log('execAgent: reusing cached workspace init for %s', boundCwd);
        return { boundCwd, workspace: cached.workspace };
      }

      const scanned = await deviceGateway.initWorkspace({
        deviceId: activeDeviceId,
        scope: boundCwd,
        userId: this.userId,
        workspaceId: deviceWorkspaceId,
      });
      if (!scanned) {
        // Scan failed (offline mid-run / parse error). Fall back to a stale
        // cache rather than dropping the project's skills + instructions.
        if (cached?.workspace) {
          log('execAgent: workspace init scan failed, using stale cache for %s', boundCwd);
          return { boundCwd, workspace: cached.workspace };
        }
        return { boundCwd, workspace: empty };
      }

      // Persist the fresh scan back onto `workingDirs` (update in place or prepend
      // a new MRU entry), keeping the JSONB payload bounded. Workspace devices
      // are owned by the workspace, not a userId — use the workspace-scoped
      // update path so the writeback actually lands.
      const updated = upsertWorkspaceScan(workingDirs, boundCwd, scanned, Date.now());
      if (deviceWorkspaceId) {
        await deviceModel.updateWorkspaceDevice(activeDeviceId, { workingDirs: updated });
      } else {
        await deviceModel.update(activeDeviceId, { workingDirs: updated });
      }
      log('execAgent: scanned and cached workspace init for %s', boundCwd);

      return { boundCwd, workspace: scanned };
    } catch (error) {
      log('execAgent: resolveWorkspaceInit failed: %O', error);
      return { workspace: empty };
    }
  }

  /**
   * Execute a single agent step against this service's runtime.
   *
   * Delegates to the internal AgentRuntimeService, which is already wired with
   * the agent-invocation fork callbacks. The QStash step worker drives stepping
   * through here so `lobe-agent.callSubAgent` can fork virtual sub-agents —
   * building a bare runtime there would lose the callback and fail with
   * SUB_AGENT_UNAVAILABLE.
   */
  executeStep(params: AgentExecutionParams): Promise<AgentExecutionResult> {
    return this.agentRuntimeService.executeStep(params);
  }

  /**
   * Run the sub-agent completion bridge against this service's runtime.
   *
   * Same rationale as `executeStep`: the QStash `subagent-callback` webhook
   * drives the bridge through here so the runtime's models stay
   * workspace-scoped — a bare AgentRuntimeService would be personal-scoped
   * and the tool-message backfill / resume barrier could miss
   * workspace-scoped rows.
   */
  completeSubAgentBridge(params: SubAgentBridgeParams): Promise<boolean> {
    return this.agentRuntimeService.completeSubAgentBridge(params);
  }

  /**
   * Resolve a run's attachments into the lists the message + context layers
   * consume. This is the single standard ingestion path shared by BOTH branches
   * of {@link execAgent} — the heterogeneous-agent branch (which returns early)
   * and the normal agent branch — so neither hand-rolls its own upload.
   *
   * Two sources are merged:
   * - `files`: raw buffers / URLs delivered by bot/IM channels (Slack, Telegram,
   *   …). These have never touched our storage, so they're uploaded to S3 here.
   * - `attachedFileIds`: already-uploaded ids (the SPA gateway path). Resolved to
   *   signed URLs and classified via {@link resolveAttachmentsByFileIds}.
   *
   * Per-file ingestion failures are collected into `warnings` and never thrown,
   * so a single bad attachment can't block the run (the text prompt still works).
   */
  private async resolveRunAttachments({
    attachedFileIds,
    files,
    throwIfAborted,
  }: {
    attachedFileIds?: string[];
    files?: InternalExecAgentParams['files'];
    throwIfAborted: (stage: string) => Promise<void>;
  }): Promise<{
    audioList?: ChatAudioItem[];
    fileIds?: string[];
    fileList?: ChatFileItem[];
    imageList?: Array<{ alt: string; id: string; url: string }>;
    videoList?: ChatVideoItem[];
    warnings: string[];
  }> {
    const warnings: string[] = [];
    let fileIds: string[] | undefined;
    let imageList: Array<{ alt: string; id: string; url: string }> | undefined;
    let videoList: ChatVideoItem[] | undefined;
    let audioList: ChatAudioItem[] | undefined;
    let fileList: ChatFileItem[] | undefined;

    // Upload raw bot/IM files to S3 and classify them (image / video / audio / document).
    if (files && files.length > 0) {
      fileIds = [];
      imageList = [];
      videoList = [];
      audioList = [];
      fileList = [];
      const fileService = new FileService(this.db, this.userId, this.workspaceId);
      const documentService = new DocumentService(this.db, this.userId, this.workspaceId);

      for (const file of files) {
        await throwIfAborted('file upload');

        try {
          const result = await ingestAttachment(file, fileService, this.userId);
          fileIds.push(result.fileId);

          if (result.isImage) {
            imageList.push({
              alt: file.name || 'image',
              id: result.fileId,
              url: result.resolvedUrl,
            });
            continue;
          }

          if (result.isVideo) {
            videoList.push({
              alt: file.name || 'video',
              id: result.fileId,
              url: result.resolvedUrl,
            });
            continue;
          }

          if (result.isAudio) {
            audioList.push({
              alt: file.name || 'audio',
              id: result.fileId,
              url: result.resolvedUrl,
            });
            continue;
          }

          // Non-image / non-video / non-audio: parse file content into the documents table so
          // the MessageContentProcessor can inject it via filesPrompts(). Mirrors
          // what the web upload path does, ensuring bot-uploaded PDFs / text /
          // JSON / .skill files are actually visible to the LLM (instead of
          // being silently uploaded but never read).
          let content: string | undefined;
          try {
            const document = await documentService.parseFile(result.fileId);
            content = document.content ?? undefined;
          } catch (parseError) {
            log(
              'execAgent: parseFile failed for %s (fileId=%s): %O',
              file.name,
              result.fileId,
              parseError,
            );
            warnings.push(
              `File "${file.name || 'unknown'}" was uploaded but its contents could not be extracted.`,
            );
          }

          fileList.push({
            content,
            fileType: file.mimeType ?? 'application/octet-stream',
            id: result.fileId,
            name: file.name ?? 'file',
            size: file.size ?? 0,
            url: result.resolvedUrl || '',
          });
        } catch (error) {
          log('execAgent: failed to ingest file %s: %O', file.name || file.url, error);
          warnings.push(`File "${file.name || 'unknown'}" could not be uploaded and was skipped.`);
        }
      }

      if (fileIds.length > 0) {
        log(
          'execAgent: uploaded %d files to S3 (%d images, %d videos, %d audios, %d documents)',
          fileIds.length,
          imageList.length,
          videoList.length,
          audioList.length,
          fileList.length,
        );
      }
      if (imageList.length === 0) imageList = undefined;
      if (videoList.length === 0) videoList = undefined;
      if (audioList.length === 0) audioList = undefined;
      if (fileList.length === 0) fileList = undefined;
    }

    // Attach already-uploaded files referenced by fileIds (e.g. SPA Gateway mode).
    // These files are already in the `files` table; resolve URLs + classify, and
    // merge into the imageList/videoList/fileList passed to the LLM and stored
    // as message relations via messagesFiles.
    if (attachedFileIds && attachedFileIds.length > 0) {
      await throwIfAborted('file resolution');

      try {
        const resolved = await resolveAttachmentsByFileIds({
          db: this.db,
          fileIds: attachedFileIds,
          userId: this.userId,
          workspaceId: this.workspaceId,
        });

        warnings.push(...resolved.warnings);

        if (resolved.orderedFileIds.length > 0) {
          fileIds = [...(fileIds ?? []), ...resolved.orderedFileIds];

          if (resolved.imageList.length > 0) {
            imageList = [...(imageList ?? []), ...resolved.imageList];
          }
          if (resolved.videoList.length > 0) {
            videoList = [...(videoList ?? []), ...resolved.videoList];
          }
          if (resolved.audioList.length > 0) {
            audioList = [...(audioList ?? []), ...resolved.audioList];
          }
          if (resolved.fileList.length > 0) {
            fileList = [...(fileList ?? []), ...resolved.fileList];
          }
        }
      } catch (err) {
        // Non-fatal: a resolver hiccup (S3 / DB blip) must not block the run —
        // the text prompt still works. Persist the file→message relation anyway
        // so the attachment isn't lost; only its preview / parsed content is.
        log('execAgent: attachment resolution failed, continuing without previews: %O', err);
        fileIds = Array.from(new Set([...(fileIds ?? []), ...attachedFileIds]));
      }
    }

    // Normalize an empty (all-failed) upload to undefined so callers don't attach
    // an empty messagesFiles relation.
    if (fileIds && fileIds.length === 0) fileIds = undefined;

    return { audioList, fileIds, fileList, imageList, videoList, warnings };
  }

  /**
   * Group-action member completion bridge entry point — driven by the QStash
   * `group-member-callback` webhook (queue mode). Forwards to the workspace-scoped
   * runtime so the member-anchor backfill + K=N barrier + resume/finish read the
   * same workspace rows. See `AgentRuntimeService.completeGroupActionMember`.
   */
  completeGroupActionMember(params: GroupActionMemberBridgeParams): Promise<boolean> {
    return this.agentRuntimeService.completeGroupActionMember(params);
  }

  /**
   * Execute agent with just a prompt
   *
   * This is a simplified API that requires agent identifier (id or slug) and prompt.
   * All necessary data (agent config, tools, messages) will be fetched from the database.
   *
   * Architecture:
   * execAgent({ agentId | slug, prompt })
   *   → AgentModel.getAgentConfig(idOrSlug)
   *   → ServerMechaModule.AgentToolsEngine(config)
   *   → ServerMechaModule.ContextEngineering(input, config, messages)
   *   → AgentRuntimeService.createOperation(...)
   */
  async execAgent(params: InternalExecAgentParams): Promise<ExecAgentResult> {
    const {
      additionalPluginIds,
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      botContext,
      deviceId: requestedDeviceId,
      botPlatformContext,
      discordContext,
      existingMessageIds = [],
      fileIds: attachedFileIds,
      files,
      functionTools,
      hooks,
      instructions,
      model: modelOverride,
      provider: providerOverride,
      stream,
      title,
      trigger,
      cronJobId,
      taskId,
      evalContext,
      maxSteps,
      disableLocalSystem,
      initialStepCount,
      signal,
      userInterventionConfig = { approvalMode: 'headless' },
      queueRetries,
      queueRetryDelay,
      parentMessageId,
      parentOperationId,
      resume,
      resumeApproval,
      suppressUserMessage,
      ephemeralUserMessage,
    } = params;

    // Validate that either agentId or slug is provided
    if (!agentId && !slug) {
      throw new Error('Either agentId or slug must be provided');
    }

    // Determine the identifier to use (agentId takes precedence)
    const identifier = agentId || slug!;

    log('execAgent: identifier=%s, prompt=%s', identifier, prompt.slice(0, 50));

    const operationTaskId = await this.resolveOperationTaskId(taskId ?? appContext?.taskId);

    const assistantMessageRef: { current?: string } = {};
    const updateAbortedAssistantMessage = async (errorMessage: string) => {
      if (!assistantMessageRef.current) return;

      try {
        await this.messageModel.update(assistantMessageRef.current, {
          content: '',
          error: {
            body: {
              detail: errorMessage,
            },
            message: errorMessage,
            type: 'ServerAgentRuntimeError',
          },
        });
      } catch (error) {
        log(
          'execAgent: failed to update aborted assistant message %s: %O',
          assistantMessageRef.current,
          error,
        );
      }
    };
    const throwIfExecutionAborted = async (stage: string) => {
      if (!signal?.aborted) return;

      const error = getAbortError(signal, `Agent execution aborted during ${stage}`);
      await updateAbortedAssistantMessage(error.message);
      throw error;
    };

    throwIfAborted(signal, 'Agent execution aborted before startup');

    // 1. Get agent configuration with default config merged (supports both id and slug)
    let agentConfig = await this.agentService.getAgentConfig(identifier);
    // Builtin agents (inbox / page / task / self-iteration slugs) may be addressed
    // purely by slug before a row exists — e.g. background self-iteration runs
    // dispatched via execAgent({ slug }). Lazily materialize the virtual row from
    // the builtin registry (mirrors the inbox/task `getBuiltinAgent` path) and
    // re-resolve. No-op for ordinary agent ids (getBuiltinAgent returns null).
    if (!agentConfig && (Object.values(BUILTIN_AGENT_SLUGS) as string[]).includes(identifier)) {
      await this.agentModel.getBuiltinAgent(identifier);
      agentConfig = await this.agentService.getAgentConfig(identifier);
    }
    if (!agentConfig) {
      throw new Error(`Agent not found: ${identifier}`);
    }

    // Use actual agent ID from config for subsequent operations
    const resolvedAgentId = agentConfig.id;

    // Persistence-attribution agent id. Background Agent Signal runs (memory /
    // skill / self-reflection) execute under a builtin slug, so `resolvedAgentId`
    // is the builtin agent — but the run's persisted messages, like its operation
    // row (createOperation appContext.agentId) and receipts, must attribute to the
    // reviewed *user* agent carried on `marker.agentId`. Ordinary runs (no marker)
    // fall back to the executing agent. Tools / systemRole / skills / agent
    // documents stay keyed on `resolvedAgentId`.
    const persistAgentId = appContext?.agentSignal?.agentId ?? resolvedAgentId;

    // Apply per-call model/provider overrides (e.g. from task.config)
    if (modelOverride) agentConfig.model = modelOverride;
    if (providerOverride) agentConfig.provider = providerOverride;

    log(
      'execAgent: got agent config for %s (id: %s), model: %s, provider: %s',
      identifier,
      resolvedAgentId,
      agentConfig.model,
      agentConfig.provider,
    );

    // 2. Merge builtin agent runtime config (systemRole, plugins)
    // The DB only stores persist config. Runtime config (e.g. inbox systemRole) is generated dynamically.
    const agentSlug = agentConfig.slug;
    const builtinSlugs = Object.values(BUILTIN_AGENT_SLUGS) as string[];
    if (agentSlug && builtinSlugs.includes(agentSlug)) {
      let userLocale: string | undefined;
      try {
        const userInfo = await UserModel.getInfoForAIGeneration(this.db, this.userId);
        userLocale = userInfo.responseLanguage;
      } catch (error) {
        log('execAgent: failed to load user locale for builtin runtime config: %O', error);
      }

      const runtimeConfig = getAgentRuntimeConfig(agentSlug, {
        model: agentConfig.model,
        plugins: agentConfig.plugins ?? [],
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
          agentConfig.plugins = runtimeConfig.plugins;
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
      agentConfig.plugins = agentConfig.plugins?.filter((id) => id !== PageAgentIdentifier);
    }

    if (appContext?.scope === 'page' && agentSlug !== BUILTIN_AGENT_SLUGS.pageAgent) {
      const pageAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.pageAgent, {
        model: agentConfig.model,
        plugins: agentConfig.plugins ?? [],
      });
      const pageAgentSystemRole = pageAgentRuntime?.systemRole || '';

      if (pageAgentSystemRole) {
        agentConfig.systemRole = agentConfig.systemRole
          ? `${agentConfig.systemRole}\n\n${pageAgentSystemRole}`
          : pageAgentSystemRole;
      }

      agentConfig.plugins = agentConfig.plugins?.includes(PageAgentIdentifier)
        ? agentConfig.plugins
        : [PageAgentIdentifier, ...(agentConfig.plugins ?? [])];
      agentConfig.chatConfig = {
        ...agentConfig.chatConfig,
        enableHistoryCount: false,
      };
      log('execAgent: injected page-agent runtime for page scope');
    }

    if (appContext?.scope === 'task' && agentSlug !== BUILTIN_AGENT_SLUGS.taskAgent) {
      const taskAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.taskAgent, {
        model: agentConfig.model,
        plugins: agentConfig.plugins ?? [],
      });
      const taskAgentSystemRole = taskAgentRuntime?.systemRole || '';

      if (taskAgentSystemRole) {
        agentConfig.systemRole = agentConfig.systemRole
          ? `${agentConfig.systemRole}\n\n${taskAgentSystemRole}`
          : taskAgentSystemRole;
      }

      agentConfig.plugins = agentConfig.plugins?.includes(TaskIdentifier)
        ? agentConfig.plugins
        : [TaskIdentifier, ...(agentConfig.plugins ?? [])];
      log('execAgent: injected task-agent runtime for task scope');
    }

    if (appContext?.isSubAgent) {
      agentConfig.plugins = agentConfig.plugins?.filter((id) => id !== LobeAgentIdentifier);
    }

    await throwIfExecutionAborted('agent configuration');

    // 2.5. Append additional instructions to agent's systemRole
    if (instructions) {
      agentConfig.systemRole = agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${instructions}`
        : instructions;
      log('execAgent: appended additional instructions to systemRole');
    }

    let resumeParentMessage;

    // `resumeApproval` implies the same "load parent message + skip user
    // message creation" semantics as `resume`. Callers that go through the
    // tRPC router get `resume: true` via the router, but the service-level
    // API allows resumeApproval alone — fold both into a single effective
    // flag so downstream resume branches don't need to know about approval.
    const effectiveResume = resume || !!resumeApproval;

    // Both resume and suppressUserMessage run the turn off existing history
    // instead of appending a new user message — share the message-construction
    // branches below. Resume-specific validation/approval stays gated on
    // `effectiveResume` only.
    const runFromHistory = effectiveResume || !!suppressUserMessage;

    if (effectiveResume) {
      if (!parentMessageId) {
        throw new Error('parentMessageId is required when resume is true');
      }

      if (!appContext) {
        throw new Error('appContext is required when resume is true');
      }

      if (!appContext.topicId) {
        throw new Error('appContext.topicId is required when resume is true');
      }

      resumeParentMessage = await this.messageModel.findById(parentMessageId);

      if (!resumeParentMessage) {
        throw new Error(`Parent message not found: ${parentMessageId}`);
      }

      if (resumeParentMessage.topicId !== appContext.topicId) {
        throw new Error('appContext.topicId does not match parent message');
      }

      if (
        resumeParentMessage.threadId &&
        resumeParentMessage.threadId !== (appContext.threadId ?? undefined)
      ) {
        throw new Error('appContext.threadId does not match parent message');
      }

      if (resumeParentMessage.sessionId && resumeParentMessage.sessionId !== appContext.sessionId) {
        throw new Error('appContext.sessionId does not match parent message');
      }
    }

    // 2.6. Human-approval resume: write the user's decision to the target tool
    // message in the DB so the history fetched below (step 11) + the runtime
    // state both reflect the decision before the first step runs. Validates
    // the parent is actually a pending tool message tied to the tool call we
    // were asked about — guards against stale / double-clicks.
    //
    // Note: `messages` and `message_plugins` live in separate tables. The
    // `messageModel.findById` query returns the `messages` row only — the
    // tool_call_id / apiName / identifier / arguments / type fields live on
    // the plugin row and must be fetched separately.
    let resumeApprovalPlugin: MessagePluginItem | undefined;

    if (resumeApproval) {
      if (!resumeParentMessage) {
        throw new Error('resumeApproval requires parentMessageId to point at a tool message');
      }
      if (resumeParentMessage.role !== 'tool') {
        throw new Error(
          `resumeApproval.parentMessageId must point at a role='tool' message, got role='${resumeParentMessage.role}'`,
        );
      }

      resumeApprovalPlugin = await this.messageModel.findMessagePlugin(
        resumeApproval.parentMessageId,
      );
      if (!resumeApprovalPlugin) {
        throw new Error(
          `resumeApproval: no plugin row for tool message ${resumeApproval.parentMessageId}`,
        );
      }
      if (
        resumeApprovalPlugin.toolCallId &&
        resumeApprovalPlugin.toolCallId !== resumeApproval.toolCallId
      ) {
        throw new Error(
          `resumeApproval.toolCallId mismatch for message ${resumeApproval.parentMessageId}: ` +
            `stored=${resumeApprovalPlugin.toolCallId}, requested=${resumeApproval.toolCallId}`,
        );
      }

      const { decision, rejectionReason } = resumeApproval;
      if (decision === 'approved') {
        await this.messageModel.updateMessagePlugin(resumeApproval.parentMessageId, {
          intervention: { status: 'approved' },
        });
      } else {
        // rejected / rejected_continue both write the same rejection content
        // + intervention state. The difference surfaces later in how the new
        // op's initial state/context are configured (halt vs. continue LLM).
        const rejectionContent = rejectionReason
          ? `User reject this tool calling with reason: ${rejectionReason}`
          : 'User reject this tool calling without reason';
        await this.messageModel.updateToolMessage(resumeApproval.parentMessageId, {
          content: rejectionContent,
        });
        await this.messageModel.updateMessagePlugin(resumeApproval.parentMessageId, {
          intervention: { rejectedReason: rejectionReason, status: 'rejected' },
        });
      }

      log(
        'execAgent: resumeApproval decision=%s applied to tool message %s (toolCallId=%s)',
        decision,
        resumeApproval.parentMessageId,
        resumeApproval.toolCallId,
      );
    }

    // 3. Handle topic creation: if no topicId provided, create a new topic; otherwise reuse existing
    let topicId = appContext?.topicId;
    const isNewTopic = !topicId;
    const topicBoundDeviceId = requestedDeviceId;
    if (!topicId) {
      if (resume) {
        throw new Error('Resume mode requires the parent message to belong to a topic');
      }

      // Prepare metadata with cronJobId, taskId, botContext, bound device, and any
      // client-supplied initial metadata (e.g. repos selected before first message).
      const initialTopicMeta = appContext?.initialTopicMetadata;
      const metadata =
        cronJobId || operationTaskId || botContext || requestedDeviceId || initialTopicMeta
          ? {
              bot: botContext,
              boundDeviceId: requestedDeviceId,
              cronJobId: cronJobId || undefined,
              taskId: operationTaskId,
              ...(initialTopicMeta?.repos && { repos: initialTopicMeta.repos }),
              ...(initialTopicMeta?.workingDirectory && {
                workingDirectory: initialTopicMeta.workingDirectory,
              }),
            }
          : undefined;

      const fallbackTitleSource = markdownToTxt(prompt);
      const newTopic = await this.topicModel.create({
        agentId: resolvedAgentId,
        // Persist the group association when running inside a group conversation.
        // Without it the topic is created group-less and only shows under the
        // member agent's topic list — never in the group sidebar (which queries
        // `topics.groupId`), so the conversation silently "disappears" from the
        // group. execGroupAgent normally pre-creates the topic, but any path
        // that reaches execAgent without a topicId (e.g. the async/queue run)
        // must carry the groupId through too. (LOBE-10604 / LOBE-10627)
        groupId: appContext?.groupId,
        metadata,
        title:
          title !== undefined
            ? title
            : fallbackTitleSource.slice(0, 50) + (fallbackTitleSource.length > 50 ? '...' : ''),
        trigger,
      });
      topicId = newTopic.id;
      log(
        'execAgent: created new topic %s with trigger %s, groupId %s, cronJobId %s',
        topicId,
        trigger || 'default',
        appContext?.groupId || 'none',
        cronJobId || 'none',
      );
    } else {
      log('execAgent: reusing existing topic %s', topicId);
    }

    await throwIfExecutionAborted('topic setup');

    // Extract model and provider from agent config
    const model = agentConfig.model!;
    const provider = agentConfig.provider!;

    // Resolve device-tool access ONCE per turn, BEFORE the hetero early exit —
    // hetero dispatch routes the whole run to a user machine, so it must honour
    // the same policy as native device tools. Discord-only flows (no
    // botContext) keep the legacy first-party allow path; an external bot
    // sender returns canUseDevice=false and reason='bot-external-sender',
    // which degrades device-capable targets (hetero → sandbox, native → plain
    // chat) and stops the device list from leaking into the LLM context.
    const { canUseDevice, reason: deviceAccessReason } = resolveDeviceAccessPolicy({
      botContext,
    });
    log(
      'execAgent: device access policy → canUseDevice=%s, reason=%s, hasBotContext=%s',
      canUseDevice,
      deviceAccessReason,
      !!botContext,
    );

    // 3.5. Hetero-agent early exit — Claude Code / Codex / OpenClaw / Hermes agents bypass the
    // server-side LLM pipeline.  After topic + message creation we hand off to
    // the device gateway (desktop) or cloud sandbox, which will push events
    // back via `heteroIngest` / `heteroFinish` (claude-code / codex) or
    // `agentNotify.notify` (openclaw / hermes).
    //
    // Detection: prefer agencyConfig.heterogeneousProvider.type (set by the UI),
    // fall back to model field for backwards compatibility.
    const HETERO_AGENT_MODELS = new Set<string>(['claude-code', 'codex']);
    const heteroProviderType = agentConfig.agencyConfig?.heterogeneousProvider?.type;
    const isHeteroAgent = !!heteroProviderType || HETERO_AGENT_MODELS.has(model);
    const heteroType = (heteroProviderType ?? model) as
      | 'claude-code'
      | 'codex'
      | 'hermes'
      | 'openclaw';

    // ── Shared turn setup (runs for BOTH hetero and normal agents) ──────────
    // Everything up to and including persisting the turn is identical for both
    // execution modes, so it lives here, before the fork, and both branches
    // consume the same records. Keeping it in one place is what guarantees the
    // hetero path can't drift from the standard path again (the bot-image bug
    // came from the hetero branch re-implementing — and skipping — this step).
    const requestTriggerMetadata =
      trigger && Object.values(RequestTrigger).includes(trigger as RequestTrigger)
        ? { trigger: trigger as RequestTrigger }
        : undefined;

    // Attachment ingestion: raw bot/IM `files` → S3, pre-uploaded
    // `attachedFileIds` → signed URLs + classification.
    const runAttachments = await this.resolveRunAttachments({
      attachedFileIds,
      files,
      throwIfAborted: throwIfExecutionAborted,
    });

    await throwIfExecutionAborted('message creation');

    // Persist the user turn. `selfMessageIds` lets the normal-path history loader
    // exclude this freshly-created turn — history must be the PRIOR turns only,
    // otherwise the new prompt is double-counted in the LLM context.
    const selfMessageIds = new Set<string>();
    const userMessageRecord = runFromHistory
      ? undefined
      : await this.messageModel.create({
          agentId: persistAgentId,
          content: prompt,
          files: runAttachments.fileIds,
          // Group reads filter on messages.groupId (MessageModel.query group
          // branch), so a group turn must stamp groupId or the message never
          // shows when the topic is reopened. (LOBE-10604 / LOBE-10627)
          groupId: appContext?.groupId ?? undefined,
          metadata: requestTriggerMetadata,
          role: 'user',
          threadId: appContext?.threadId ?? undefined,
          topicId,
        });
    if (userMessageRecord) {
      selfMessageIds.add(userMessageRecord.id);
      log('execAgent: created user message %s', userMessageRecord.id);
    }

    // Assistant placeholder (shows the spinner in the UI). A hetero run seeds
    // ONLY the provider — the CLI reports the real model later via `stream_start`
    // / `turn_metadata` (backfilled by HeterogeneousPersistenceHandler), and
    // seeding the agent's chat model would leak it into the model tag. A normal
    // run seeds model + provider as usual.
    const assistantMessageRecord = await this.messageModel.create({
      agentId: persistAgentId,
      content: LOADING_FLAT,
      // Stamp groupId so the assistant turn is visible in the group read path
      // (MessageModel.query filters group chats by messages.groupId).
      groupId: appContext?.groupId ?? undefined,
      model: isHeteroAgent ? undefined : model,
      parentId: parentMessageId ?? userMessageRecord?.id,
      provider: isHeteroAgent ? heteroType : provider,
      role: 'assistant',
      threadId: appContext?.threadId ?? undefined,
      topicId,
    });
    selfMessageIds.add(assistantMessageRecord.id);
    assistantMessageRef.current = assistantMessageRecord.id;
    log('execAgent: created assistant message %s', assistantMessageRecord.id);

    // Agent Signal is a governance side-channel (feedback / self-iteration). It
    // only applies to the server-side LLM pipeline, so it is intentionally NOT
    // enqueued for hetero runs (which hand off to an external CLI). Skip when this
    // invocation is itself an Agent Signal background run to avoid recursion.
    if (
      userMessageRecord &&
      !isHeteroAgent &&
      !shouldSuppressSignal({ appContext, slug: agentSlug ?? undefined })
    ) {
      void enqueueAgentSignalSourceEvent(
        {
          payload: {
            agentId: resolvedAgentId,
            message: prompt,
            messageId: userMessageRecord.id,
            threadId: appContext?.threadId ?? undefined,
            topicId,
            trigger,
          },
          sourceId: userMessageRecord.id,
          sourceType: 'agent.user.message',
        },
        {
          agentId: resolvedAgentId,
          userId: this.userId,
        },
      ).catch((error) => {
        log('execAgent: failed to enqueue user message Agent Signal source event: %O', error);
      });
    }

    if (isHeteroAgent) {
      const isRemoteHetero = isRemoteHeterogeneousType(heteroType);
      const operationId = nanoid();

      // Persist a first-class agent_operations row for the hetero run. The id is
      // generated here (authoritative) and flows through to heteroIngest /
      // heteroFinish unchanged. Without this row the run is invisible to the
      // operation lifecycle: verify (ensureForOperation), repair (parent chain),
      // judge (op.model/provider) and tracing all key off it. Terminal state +
      // the trace snapshot are written back in heteroFinish. Non-fatal: a
      // tracing/op-row insert hiccup must never fail the user's run (verify just
      // degrades to off for this run).
      try {
        await this.agentOperationModel.recordStart({
          agentId: persistAgentId,
          chatGroupId: appContext?.groupId ?? null,
          maxSteps,
          model,
          operationId,
          provider,
          taskId: operationTaskId ?? null,
          threadId: appContext?.threadId ?? null,
          topicId,
          trigger,
        });
      } catch (err) {
        log('execAgent: hetero recordStart failed (non-fatal): %O', err);
      }

      // Read resume session id for next-turn continuity.
      const heteroService = new HeterogeneousAgentService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      });
      const resumeSessionId = await heteroService.getHeterogeneousResumeSessionId(topicId);
      // Sign an operation-scoped JWT so the CLI can authenticate against
      // heteroIngest / heteroFinish without full user credentials.
      let operationJwt: string;
      try {
        operationJwt = await signOperationJwt(this.userId);
      } catch (err) {
        log('execAgent: failed to sign operation JWT for hetero run: %O', err);
        throw new Error('Failed to sign operation JWT for hetero agent', { cause: err });
      }

      // Read repos from topic metadata for sandbox setup (web/cloud only).
      const topic = await this.topicModel.findById(topicId);
      const topicRepos: string[] = topic?.metadata?.repos ?? [];

      // Resolve GitHub OAuth token for the sandbox. Always attempt so CC can use
      // git / gh CLI even when no repos are pre-selected. Falls back to the
      // standard 'github' key (LobeHub OAuth connector default); agent config can
      // override via GITHUB_CRED_KEY.
      let githubToken: string | undefined;
      const githubCredKey =
        agentConfig.agencyConfig?.heterogeneousProvider?.env?.GITHUB_CRED_KEY ?? 'github';
      try {
        const list = await this.marketService.market.creds.list();
        const cred = list.data?.find((c: { key: string }) => c.key === githubCredKey);
        if (cred) {
          const full = await this.marketService.market.creds.get(cred.id, { decrypt: true });
          const vals = (full as any).plaintext ?? (full as any).values ?? {};
          githubToken = vals.access_token ?? vals.token;
        }
      } catch (err) {
        log('execAgent: failed to resolve GitHub token: %O', err);
      }

      // When resuming, inject the recent conversation turns as context so CC can
      // orient itself even if the native session file was cleared (sandbox recycled
      // or context overflow caused the CLI to start a fresh session).
      // Only fetch when there IS a stored session id — for first-turn runs CC has
      // no prior history to inject.
      let conversationHistory: ConversationHistoryEntry[] | undefined;
      if (resumeSessionId) {
        try {
          const recentMsgs = await this.messageModel.query({ topicId, pageSize: 200 });
          const turns = recentMsgs
            .filter(
              (m) =>
                (m.role === 'user' || m.role === 'assistant') &&
                !m.threadId &&
                m.content &&
                m.content !== LOADING_FLAT,
            )
            .slice(-30)
            .map((m) => ({
              content: m.content ?? '',
              role: m.role as 'assistant' | 'user',
            }));
          if (turns.length > 0) conversationHistory = turns;
        } catch (err) {
          log('execAgent: failed to load conversation history for hetero context: %O', err);
        }
      }

      // Build cloud-specific system context (repo list + workspace info + optional agent-level static context).
      const { buildCloudHeteroContext } =
        await import('@/server/services/heterogeneousAgent/cloudHeteroContext');
      const systemContext = buildCloudHeteroContext({
        agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
        conversationHistory,
        githubToken,
        repos: topicRepos,
      });

      // Feed the resolved images (signed URLs) to the dispatched CLI for vision —
      // mirrors the local-mode path, where the client feeds the persisted
      // message's imageList into `sendPrompt`. Reuses the shared resolution above
      // so bot/IM and SPA gateway attachments are handled identically.
      const heteroImageList =
        runAttachments.imageList && runAttachments.imageList.length > 0
          ? runAttachments.imageList.map((image) => ({ id: image.id, url: image.url }))
          : undefined;
      const heteroExecArgs =
        heteroType === 'claude-code' || heteroType === 'codex'
          ? buildHeteroExecArgs(
              agentConfig.agencyConfig?.heterogeneousProvider?.type === heteroType
                ? agentConfig.agencyConfig.heterogeneousProvider
                : { type: heteroType },
            )
          : undefined;

      const heteroParams = {
        agentType: heteroType,
        assistantMessageId: assistantMessageRecord.id,
        githubToken,
        imageList: heteroImageList,
        jwt: operationJwt,
        operationId,
        prompt,
        repos: topicRepos,
        resumeSessionId,
        systemContext,
        topicId,
        userId: this.userId,
      };

      const remoteDeviceId =
        requestedDeviceId || agentConfig.agencyConfig?.boundDeviceId || undefined;

      // Register the run's lifecycle hooks so the hetero terminal path fires
      // onComplete/onError through the same `hookDispatcher` the normal LLM
      // runtime uses — driving the task lifecycle (onTopicComplete) and IM bot
      // completion callbacks uniformly. The hetero block returns before
      // AgentRuntimeService (which registers hooks for normal runs), so we do it
      // here. Local mode dispatches these in-memory handlers; queue mode
      // delivers the serialized webhooks persisted on runningOperation below.
      if (hooks?.length) hookDispatcher.register(operationId, hooks);
      const serializedHooks = hookDispatcher.getSerializedHooks(operationId);

      // Seed topic.metadata.runningOperation so heteroIngest can validate the
      // operation, and so every terminal site (heteroFinish, agentNotify done,
      // dispatch failure) can re-fire the serialized hooks across a process
      // boundary in queue mode.
      await this.topicModel.updateMetadata(topicId, {
        runningOperation: {
          assistantMessageId: assistantMessageRecord.id,
          hooks: serializedHooks,
          // Store deviceId + heteroType so interruptTask can cancel remote processes
          ...(isRemoteHetero && remoteDeviceId
            ? { deviceId: remoteDeviceId, heteroType }
            : undefined),
          operationId,
          scope: appContext?.scope ?? undefined,
          threadId: appContext?.threadId ?? undefined,
        },
      });

      // Remote hetero agents (openclaw / hermes) dispatch to the device identified
      // by agencyConfig.boundDeviceId and communicate back via agentNotify.notify.
      // They always go through the gateway WS channel — open the stream now so the
      // frontend can subscribe before the first lh notify arrives.

      if (isRemoteHetero) {
        // Remote hetero agents are device-only — there is no sandbox to
        // degrade to, so a denied sender (external bot user) is refused
        // outright instead of reaching the owner's machine.
        if (!canUseDevice) {
          log(
            'execAgent: device access denied for remote hetero dispatch (reason=%s)',
            deviceAccessReason,
          );
          await this.finalizeHeteroDispatchError({
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            detail: 'This sender is not allowed to run agents on a bound device.',
            message: 'Device access denied',
            operationId,
            topicId,
          });
          return {
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            autoStarted: false,
            createdAt: new Date().toISOString(),
            error: 'Device access denied',
            message: 'Remote hetero agent requires device access',
            operationId,
            status: 'error',
            success: false,
            timestamp: new Date().toISOString(),
            topicId,
            userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
          };
        }
        if (!remoteDeviceId) {
          log('execAgent: openclaw/hermes requires a bound device (boundDeviceId not set)');
          await this.finalizeHeteroDispatchError({
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            detail: 'No device bound to this agent. Configure boundDeviceId.',
            message: 'No bound device for remote hetero agent',
            operationId,
            topicId,
          });
          return {
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            autoStarted: false,
            createdAt: new Date().toISOString(),
            error: 'No bound device',
            message: 'Remote hetero agent requires boundDeviceId',
            operationId,
            status: 'error',
            success: false,
            timestamp: new Date().toISOString(),
            topicId,
            userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
          };
        }

        // Open the stream channel so the gateway WS subscription can receive
        // notify_update events published by agentNotify.notify.
        const streamManager = createStreamEventManager();
        await streamManager
          .publishAgentRuntimeInit(operationId, {
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            heteroType,
            topicId,
            userId: this.userId,
          })
          .catch((err) => log('execAgent: failed to init stream for remote hetero: %O', err));

        // lh connect only handles tool_call_request (not agent_run_request),
        // so we use executeToolCall with the runHeteroTask tool instead of dispatchAgentRun.
        const remoteDeviceWorkspaceId = await this.resolveDeviceWorkspaceId(remoteDeviceId);
        const result = await deviceGateway.executeToolCall(
          { deviceId: remoteDeviceId, userId: this.userId, workspaceId: remoteDeviceWorkspaceId },
          {
            apiName: 'runHeteroTask',
            arguments: JSON.stringify({
              agentId: resolvedAgentId,
              agentType: heteroType,
              cwd: undefined,
              operationId,
              prompt,
              taskId: operationId,
              topicId,
              // Scope notify callbacks to the same workspace as the dispatched
              // topic so agentNotify can resolve the workspace-owned topic.
              // Without this the device's notify call falls back to personal
              // mode and TopicModel.findById returns NOT_FOUND.
              workspaceId: remoteDeviceWorkspaceId,
            }),
            identifier: 'runHeteroTask',
          },
          120_000, // hetero tasks can take longer than the default 30 s
        );
        if (!result.success) {
          log('execAgent: remote hetero dispatch failed: %s', result.error);
          await this.finalizeHeteroDispatchError({
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            detail: result.error ?? 'Device dispatch failed',
            message: result.error ?? 'Device dispatch failed',
            operationId,
            topicId,
          });
          return {
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            autoStarted: false,
            createdAt: new Date().toISOString(),
            error: result.error,
            message: 'Remote hetero agent dispatch failed',
            operationId,
            status: 'error',
            success: false,
            timestamp: new Date().toISOString(),
            topicId,
            userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
          };
        }
      } else {
        // Local CLI hetero (claude-code / codex) — fork between device dispatch
        // and cloud sandbox via the shared execution plan:
        //   - requestedDeviceId (topic-level override) always wins
        //   - executionTarget 'device' → dispatch to boundDeviceId (errors if unset)
        //   - executionTarget 'local' + boundDeviceId (desktop sync opened on web)
        //     → dispatch to that device
        //   - everything else ('sandbox' / unbound 'local' / 'none' / unset) → cloud
        //     sandbox (the server can't spawn locally, and a hetero agent must
        //     execute somewhere)
        // `onlineDeviceIds` is intentionally omitted: hetero dispatch trusts
        // the binding and fails loudly at the gateway if the device is offline.
        // `canUseDevice` degrades device-capable targets to the sandbox for
        // denied senders (e.g. external bot users) — without it a synced
        // local/device binding would let them run on the owner's machine.
        const heteroPlan = resolveExecutionPlan({
          agencyConfig: agentConfig.agencyConfig,
          canUseDevice,
          isHetero: true,
          clientExecutionAvailable: false,
          requestedDeviceId,
          trigger: requestTriggerMetadata?.trigger,
        });

        if (heteroPlan.kind !== 'sandbox') {
          const dispatchDeviceId = heteroPlan.kind === 'device' ? heteroPlan.deviceId : undefined;
          if (!dispatchDeviceId) {
            log('execAgent: hetero executionTarget=device but no boundDeviceId set');
            await this.finalizeHeteroDispatchError({
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              detail:
                'No device bound. Pick a device in the Execution Device switcher, or switch to Cloud sandbox.',
              message: 'No bound device for hetero agent',
              operationId,
              topicId,
            });
            return {
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              autoStarted: false,
              createdAt: new Date().toISOString(),
              error: 'No bound device',
              message: 'Hetero agent requires a bound device',
              operationId,
              status: 'error',
              success: false,
              timestamp: new Date().toISOString(),
              topicId,
              userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
            };
          }
          // Resolve the working directory for the run: a topic-level override
          // wins, else the device's user-configured defaultCwd. The device row
          // lives in the DB (the gateway only knows live connections), so read
          // it directly rather than via deviceGateway.
          // The bound device may be personal (userId-scoped) or a workspace
          // device (workspace-scoped) — look up both so its defaultCwd resolves.
          const deviceModelForCwd = new DeviceModel(this.db, this.userId, this.workspaceId);
          const boundDevice =
            (await deviceModelForCwd.findByDeviceId(dispatchDeviceId)) ??
            (await deviceModelForCwd.findWorkspaceDeviceById(dispatchDeviceId));
          const dispatchWorkspaceId = await this.resolveDeviceWorkspaceId(dispatchDeviceId);
          // Resolve via the shared precedence helper so dispatch, workspace-init,
          // and the new-topic backfill below all agree on the cwd.
          const deviceCwd = resolveDeviceWorkingDirectory({
            deviceDefaultCwd: boundDevice?.defaultCwd,
            deviceId: dispatchDeviceId,
            initialWorkingDirectory: appContext?.initialTopicMetadata?.workingDirectory,
            topicWorkingDirectory: topic?.metadata?.workingDirectory,
            workingDirByDevice: agentConfig.agencyConfig?.workingDirByDevice,
          });

          // A brand-new topic has no pinned cwd yet: the directory was only
          // recorded at agent level (`workingDirByDevice`) when no topic existed.
          // Persist the resolved cwd onto the topic so the sidebar groups it
          // under the right project and the next turn reuses the same directory.
          if (isNewTopic && deviceCwd && deviceCwd !== topic?.metadata?.workingDirectory) {
            await this.topicModel.updateMetadata(topicId, { workingDirectory: deviceCwd });
          }

          // A device is the user's own persistent machine — build a
          // device-specific context instead of reusing the cloud-sandbox one
          // (which describes an ephemeral /workspace + pre-cloned repos and
          // would mislead the agent).
          const { buildRemoteDeviceHeteroContext } =
            await import('@/server/services/heterogeneousAgent/remoteDeviceHeteroContext');
          const deviceSystemContext = buildRemoteDeviceHeteroContext({
            agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
            conversationHistory,
            cwd: deviceCwd,
          });

          const result = await deviceGateway.dispatchAgentRun({
            ...heteroParams,
            cwd: deviceCwd,
            deviceId: dispatchDeviceId,
            systemContext: deviceSystemContext,
            // Route to the workspace pool when this is a workspace device; the
            // operation JWT stays member-scoped (the run belongs to the member).
            workspaceId: dispatchWorkspaceId,
          });
          if (!result.success) {
            log('execAgent: hetero device dispatch failed: %s', result.error);
            await this.finalizeHeteroDispatchError({
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              detail: result.error ?? 'Device dispatch failed',
              message: result.error ?? 'Device dispatch failed',
              operationId,
              topicId,
            });
            return {
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              autoStarted: false,
              createdAt: new Date().toISOString(),
              error: result.error,
              message: 'Hetero agent device dispatch failed',
              operationId,
              status: 'error',
              success: false,
              timestamp: new Date().toISOString(),
              topicId,
              userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
            };
          }
        } else {
          // Cloud sandbox path — only for local CLI agents (claude-code / codex).
          // Remote agents (openclaw / hermes) always require a bound device.
          const { spawnHeteroSandbox } =
            await import('@/server/services/heterogeneousAgent/sandboxRunner');
          spawnHeteroSandbox({
            ...heteroParams,
            agentType: heteroType as 'claude-code' | 'codex',
            args: heteroExecArgs,
            marketService: this.marketService,
          }).catch(async (err) => {
            // Fire-and-forget: execAgent has already returned `autoStarted`, and
            // the sandbox never reached the point of calling heteroFinish. Drive
            // the same terminal funnel so the stranded run surfaces an error and
            // its task is marked failed instead of hanging in `running`.
            log('execAgent: hetero sandbox spawn failed: %O', err);
            await this.finalizeHeteroDispatchError({
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              detail: err instanceof Error ? err.message : String(err),
              message: 'Hetero sandbox spawn failed',
              operationId,
              topicId,
            }).catch((finalizeErr) =>
              log('execAgent: sandbox-failure finalize failed: %O', finalizeErr),
            );
          });
        }
      }

      let gatewayToken: string | undefined;
      try {
        gatewayToken = await signUserJWT(this.userId);
      } catch {
        // non-critical
      }

      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Hetero agent dispatched successfully',
        operationId,
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        token: gatewayToken,
        topicId,
        userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
      };
    }

    // 4. Fetch user settings (memory config + timezone)
    // Agent-level memory config takes priority; fallback to user-level setting
    const agentMemoryEnabled = agentConfig.chatConfig?.memory?.enabled;
    let globalMemoryEnabled = agentMemoryEnabled ?? false;
    let userTimezone: string | undefined;
    try {
      const userModel = new UserModel(this.db, this.userId);
      const settings = await userModel.getUserSettings();
      const memorySettings = settings?.memory as { enabled?: boolean } | undefined;

      globalMemoryEnabled = agentMemoryEnabled ?? memorySettings?.enabled !== false;

      const generalSettings = settings?.general as { timezone?: string } | undefined;
      userTimezone = generalSettings?.timezone;
    } catch (error) {
      log('execAgent: failed to fetch user settings: %O', error);
    }
    log(
      'execAgent: globalMemoryEnabled=%s, timezone=%s',
      globalMemoryEnabled,
      userTimezone ?? 'default',
    );

    // 5. Tool discovery — short-circuit when disableTools is set
    let tools: any[] | undefined;
    let toolsResult: { enabledToolIds: string[]; tools?: any[] | undefined } = {
      enabledToolIds: [],
      tools: undefined,
    };
    const toolManifestMap: Record<string, any> = {};
    const toolSourceMap: Record<string, ToolSource> = {};
    const toolExecutorMap: Record<string, ToolExecutor> = {};
    let onlineDevices: DeviceAttachment[] = [];
    let activeDeviceId: string | undefined;
    let executionPlan: ExecutionPlan | undefined;
    let hasAgentDocuments = false;
    let hasEnabledKnowledgeBases = false;
    const isBotConversation = !!(botContext || discordContext);

    // Device-tool access (`canUseDevice` / `deviceAccessReason`) was resolved
    // once before the hetero early exit above; the decision flows into the
    // engine's enable gates (LocalSystem / RemoteDevice) and the RemoteDevice
    // systemRole injection below.

    // These are needed outside the tools block (for agent management context, skill engine, etc.)
    let lobehubSkillManifests: LobeToolManifest[] = [];
    let composioManifests: LobeToolManifest[] = [];
    let connectorManifests: ReturnType<typeof buildConnectorManifests> = [];
    let agentPlugins: string[] = [...(agentConfig?.plugins ?? []), ...(additionalPluginIds || [])];

    // Model metadata is needed both for tool support checks and agent-management context.
    const { loadModels } = await import('@/business/client/model-bank/loadModels');
    const builtinModels = await loadModels();
    // Resolve file URLs before visual tool activation checks and context build.
    const fileService = new FileService(this.db, this.userId, this.workspaceId);
    const postProcessUrl = (path: string | null, file: { id?: string | null }) =>
      fileService.getFileAccessUrl({ id: file.id, url: path });
    let historyMessagesCache: any[] | undefined;
    const loadHistoryMessages = async () => {
      if (historyMessagesCache) return historyMessagesCache;

      if (existingMessageIds.length > 0) {
        const messages = await this.messageModel.query(
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
        const messages = await this.messageModel.query(
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

      return historyMessagesCache;
    };

    if (params.disableTools) {
      log('execAgent: tools disabled by disableTools flag, skipping all tool discovery');
    } else {
      // 5a. Get installed plugins from database
      const installedPlugins = await this.pluginModel.query();
      log('execAgent: got %d installed plugins', installedPlugins.length);

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
          ? await this.connectorModel.queryByIdentifiers(agentPlugins, connectorGateKeeper)
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
          ? await this.connectorToolModel.queryAllByConnectorIds(connectorsMcp.map((c) => c.id))
          : [];

      connectorManifests = buildConnectorManifests(connectorsMcp, connectorTools);

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
        lobehubSkillManifests = await this.marketService.getLobehubSkillManifests();
      } catch (error) {
        log('execAgent: failed to fetch lobehub skill manifests: %O', error);
      }
      log('execAgent: got %d lobehub skill manifests', lobehubSkillManifests.length);

      // 5d. Fetch Composio tool manifests from database
      try {
        composioManifests = await this.composioService.getComposioManifests();
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
          const { patchManifestWithPermissions } =
            await import('@/libs/mcp/connectorPermissionCheck');
          const { ConnectorToolModel } = await import('@/database/models/connectorTool');
          const allIdentifiers = [
            ...lobehubSkillManifests.map((m) => m.identifier),
            ...composioManifests.map((m) => m.identifier),
            ...pluginsWithoutConnectors.map((p) => p.identifier),
          ];
          const connectorEntries =
            allIdentifiers.length > 0
              ? await this.connectorModel.queryByIdentifiers(allIdentifiers)
              : [];

          if (connectorEntries.length > 0) {
            const toolModel = new ConnectorToolModel(this.db, this.userId, this.workspaceId);
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
        agentConfig.knowledgeBases?.some(
          (kb: { enabled?: boolean | null }) => kb.enabled === true,
        ) ?? false;

      try {
        hasAgentDocuments = await this.agentDocumentsService.hasDocuments(resolvedAgentId);
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
          // Personal pool (user principal) ∪ the current workspace's shared pool
          // (workspace principal). Workspace devices are absent for non-workspace
          // runs, so this is identical to the personal-only fetch there.
          const [personalOnline, workspaceOnline] = await Promise.all([
            deviceGateway.queryDeviceList(this.userId),
            this.workspaceId
              ? deviceGateway.queryDeviceList(this.userId, this.workspaceId)
              : Promise.resolve([]),
          ]);
          onlineDevices = [...personalOnline, ...workspaceOnline];
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
        builtinModels.find((item) => item.id === model && item.providerId === provider)
          ?.abilities ?? builtinModels.find((item) => item.id === model)?.abilities;
      const externalFileTypes = files?.map((file) => file.mimeType ?? '') ?? [];
      let attachedFileTypes: string[] = [];
      if (attachedFileIds && attachedFileIds.length > 0) {
        const fileModel = new FileModel(this.db, this.userId, this.workspaceId);
        const fileRecords = await fileModel.findByIds(Array.from(new Set(attachedFileIds)));
        attachedFileTypes = fileRecords.map((file) => file.fileType || '');
      }
      const inputFileTypes = [...externalFileTypes, ...attachedFileTypes];
      const inputVisualAvailability = getVisualAvailabilityFromFileTypes(inputFileTypes);
      let historyVisualAvailability = { hasImages: false, hasVideos: false };
      const visualUnderstandingConfigured = isVisualUnderstandingConfigured();

      if (
        visualUnderstandingConfigured &&
        ((!modelAbilities?.vision && !inputVisualAvailability.hasImages) ||
          (!modelAbilities?.video && !inputVisualAvailability.hasVideos))
      ) {
        historyVisualAvailability = getVisualAvailabilityFromMessages(await loadHistoryMessages());
      }

      const needsImageUnderstanding =
        (inputVisualAvailability.hasImages || historyVisualAvailability.hasImages) &&
        !modelAbilities?.vision;
      const needsVideoUnderstanding =
        (inputVisualAvailability.hasVideos || historyVisualAvailability.hasVideos) &&
        !modelAbilities?.video;
      const shouldEnableVisualUnderstanding =
        visualUnderstandingConfigured && (needsImageUnderstanding || needsVideoUnderstanding);
      agentPlugins = [
        ...agentPlugins,
        ...(hasTopicReference ? ['lobe-topic-reference'] : []),
        ...(isBotConversation ? [MessageToolIdentifier] : []),
        ...(shouldEnableVisualUnderstanding ? [LobeAgentManifest.identifier] : []),
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
        onlineDeviceIds: onlineDevices.map((device) => device.deviceId),
        requestedDeviceId,
        trigger: requestTriggerMetadata?.trigger,
      });
      // Device tools (local-system / remote-device proxy) only exist in a
      // device-capable session — `none` and `sandbox` sessions must never see
      // them, not even the proxy that could activate a device mid-run.
      const deviceCapable = isDeviceCapablePlan(executionPlan);
      activeDeviceId = executionPlan.kind === 'device' ? executionPlan.deviceId : undefined;
      log(
        'execAgent: execution plan → kind=%s deviceId=%s',
        executionPlan.kind,
        activeDeviceId ?? 'none',
      );

      const toolsEngine = createServerAgentToolsEngine(toolsContext, {
        additionalManifests: [
          ...lobehubSkillManifests,
          ...composioManifests,
          ...connectorManifests,
        ],
        agentConfig: {
          chatConfig: agentConfig.chatConfig ?? undefined,
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
        executionPlan,
        globalMemoryEnabled,
        hasEnabledKnowledgeBases,
        isBotConversation,
        model,
        provider,
      });

      // 5f. Generate tools and manifest map
      const pluginIds = [
        ...new Set([
          ...agentPlugins,
          ...(disableLocalSystem ? [] : [LocalSystemManifest.identifier]),
          RemoteDeviceManifest.identifier,
          // Include LobeHub Skills and Composio tools so they are passed to generateToolsDetailed
          ...lobehubSkillManifests.map((m) => m.identifier),
          ...composioManifests.map((m) => m.identifier),
          // Connector manifests are also injected as additionalManifests
          ...connectorManifests.map((m) => m.identifier),
        ]),
      ];
      log('execAgent: agent configured plugins: %O', pluginIds);

      const isManualMode = agentConfig.chatConfig?.skillActivateMode === 'manual';

      toolsResult = toolsEngine.generateToolsDetailed({
        excludeDefaultToolIds: isManualMode ? manualModeExcludeToolIds : undefined,
        model,
        provider,
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
      const isManifestIngestAllowed = (identifier: string): boolean =>
        canUseDevice || !isDeviceToolIdentifier(identifier);

      // Start with the scoped manifest map (pluginIds + defaultToolIds)
      const manifestMap = toolsEngine.getEnabledPluginManifests(pluginIds);
      manifestMap.forEach((manifest, id) => {
        if (!isManifestIngestAllowed(id)) return;
        toolManifestMap[id] = manifest;
      });

      // Also include discoverable builtin tools that are not yet in the map,
      // so the activator can find their manifests when dynamically enabling them
      // (e.g., lobe-creds, lobe-cron). Exclude discoverable:false tools to prevent
      // internal infrastructure tools from being surfaced to the activator.
      const allowedBuiltinTools = buildAllowedBuiltinTools({
        canUseDevice,
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
        gatewayConfigured &&
        agentRuntimeMode === 'local' &&
        !toolManifestMap[LocalSystemManifest.identifier]
      ) {
        toolManifestMap[LocalSystemManifest.identifier] = LocalSystemManifest as LobeToolManifest;
      }

      // Include lobehub skill and composio manifests for activator discovery
      for (const manifest of lobehubSkillManifests) {
        if (!isManifestIngestAllowed(manifest.identifier)) continue;
        if (!toolManifestMap[manifest.identifier]) {
          toolManifestMap[manifest.identifier] = manifest;
        }
      }
      for (const manifest of composioManifests) {
        if (!isManifestIngestAllowed(manifest.identifier)) continue;
        if (!toolManifestMap[manifest.identifier]) {
          toolManifestMap[manifest.identifier] = manifest;
        }
      }

      for (const manifest of lobehubSkillManifests) {
        if (!isManifestIngestAllowed(manifest.identifier)) continue;
        toolSourceMap[manifest.identifier] = 'lobehubSkill';
      }
      for (const manifest of composioManifests) {
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
        !params.disableSelfFeedbackIntentTool && (agentSelfIterationEnabled || isLobeAiAgent);
      if (shouldCheckUserSelfIterationGate) {
        const featureUserEnabled = await isAgentSignalEnabledForUser(this.db, this.userId);
        const effectiveAgentSelfIterationEnabled = resolveAgentSelfIterationCapability({
          agentSelfIterationEnabled,
          isAgentSelfIterationFeatureEnabled: featureUserEnabled,
          isLobeAiAgent,
        });

        if (
          shouldExposeSelfFeedbackIntentTool({
            agentSelfIterationEnabled: effectiveAgentSelfIterationEnabled,
            disableSelfFeedbackIntentTool: params.disableSelfFeedbackIntentTool,
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

    // 9.4. Fetch device system info for placeholder variable replacement.
    //
    // Decoupled from activeDeviceId routing (): pulled into a helper
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
        const systemInfo = await deviceGateway.queryDeviceSystemInfo(this.userId, deviceId);
        if (!systemInfo) return {};
        const device = onlineDevices.find((d) => d.deviceId === deviceId);
        log('execAgent: fetched device system info for %s', deviceId);
        return {
          arch: systemInfo.arch,
          desktopPath: systemInfo.desktopPath,
          documentsPath: systemInfo.documentsPath,
          downloadsPath: systemInfo.downloadsPath,
          homePath: systemInfo.homePath,
          hostname: device?.hostname ?? 'unknown',
          musicPath: systemInfo.musicPath,
          picturesPath: systemInfo.picturesPath,
          platform: device?.platform ?? 'unknown',
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
      const recentAgents = await this.agentModel.queryAgents({
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
      const aiModelModel = new AiModelModel(this.db, this.userId);
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

        const provider = providerMap.get(userModel.providerId)!;
        provider.models.push({
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
        const personaModel = new UserPersonaModel(this.db, this.userId);
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
      id: userMessageRecord?.id,
      imageList: runAttachments.imageList,
      role: 'user' as const,
      videoList: runAttachments.videoList,
    };

    // Combine history messages with the user message. An ephemeral message is
    // injected into the LLM context even under runFromHistory (suppressUserMessage)
    // — it drives this turn but was never persisted (id is undefined).
    const allMessages =
      runFromHistory && !ephemeralUserMessage ? historyMessages : [...historyMessages, userMessage];

    log('execAgent: prepared evalContext for executor');

    await throwIfExecutionAborted('operation preparation');

    // 15. Generate operation ID: agt_{timestamp}_{agentId}_{topicId}_{random}
    const timestamp = Date.now();
    const operationId = `op_${timestamp}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

    // 16. Create initial context
    let initialContext: AgentRuntimeContext = {
      payload: {
        // Pass assistant message ID so agent runtime knows which message to update
        assistantMessageId: assistantMessageRecord.id,
        isFirstMessage: true,
        message:
          runFromHistory && !ephemeralUserMessage
            ? [{ content: '' }]
            : [{ content: ephemeralUserMessage ?? prompt }],
        // Pass user message ID as parentMessageId for reference
        parentMessageId: parentMessageId ?? userMessageRecord?.id ?? '',
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
        const row = await this.agentDocumentsService.findRowByDocumentId(
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

    // 16b. Human-approval resume — override initialContext based on the
    // user's decision. The DB write above has already persisted the
    // intervention status, so `allMessages` reflects the decision for the
    // LLM / runner on the first step.
    //
    // `rejected` and `rejected_continue` share the same server-side path:
    // both surface the rejection to the LLM as user feedback via
    // `phase: 'user_input'`. The client-side split (halt vs. continue) is
    // only about the UX of the button and the optimistic writes — once the
    // decision is persisted, there's nothing meaningful to do differently
    // server-side, and letting the LLM produce a brief acknowledgement keeps
    // the conversation cleanly terminated either way.
    if (resumeApproval && resumeApprovalPlugin) {
      if (resumeApproval.decision === 'approved') {
        // Ask the runtime to execute the approved tool directly. Matches the
        // `phase: 'human_approved_tool'` contract used by the in-place
        // handleHumanIntervention flow — the runner generates a `call_tool`
        // instruction keyed on this payload. All tool metadata comes from
        // the plugin row fetched above; missing any of identifier/apiName
        // breaks the server-side tool executor dispatch.
        initialContext = {
          initialContext: initialContext.initialContext,
          payload: {
            approvedToolCall: {
              apiName: resumeApprovalPlugin.apiName,
              arguments: resumeApprovalPlugin.arguments,
              id: resumeApproval.toolCallId,
              identifier: resumeApprovalPlugin.identifier,
              type: resumeApprovalPlugin.type ?? 'default',
            },
            assistantMessageId: assistantMessageRecord.id,
            parentMessageId: resumeApproval.parentMessageId,
            skipCreateToolMessage: true,
          } as any,
          phase: 'human_approved_tool' as const,
          session: {
            messageCount: allMessages.length,
            sessionId: operationId,
            status: 'idle' as const,
            stepCount: 0,
          },
        };
      } else {
        initialContext = {
          ...initialContext,
          payload: {
            ...(initialContext.payload as any),
            isFirstMessage: false,
            message: [{ content: '' }],
            parentMessageId: resumeApproval.parentMessageId,
          },
        };
      }
    }

    // 17. Log final operation parameters summary
    log(
      'execAgent: creating operation %s with params: model=%s, provider=%s, tools=%d, messages=%d, manifests=%d',
      operationId,
      model,
      provider,
      tools?.length ?? 0,
      allMessages.length,
      Object.keys(toolManifestMap).length,
    );

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
      const skillModel = new AgentSkillModel(this.db, this.userId, this.workspaceId);
      const { data: dbSkills } = await skillModel.findAll();
      const dbMetas = dbSkills.map((s) => ({
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
      const agentSkills = await this.agentDocumentsService.getAgentSkills(resolvedAgentId);
      const agentSkillMetas = agentSkills.map((skill) => ({
        description: skill.description,
        identifier: skill.identifier,
        name: skill.name,
      }));

      // Project skills + the root AGENTS.md are discovered server-side by
      // scanning the device's bound project directory ("workspace init"), cached
      // on `devices.workingDirs` and reused within the TTL. Skills surface in
      // `<available_skills>` (metadata only — SKILL.md bodies are read lazily at
      // activation via `local-system` readFile, which `serverRuntimes/skills.ts`
      // re-gates on `activeDeviceId`). Only `location` (the absolute SKILL.md
      // path) flows through; the directory tree is enumerated lazily, keeping the
      // op-param payload small.
      const workspaceInit = await this.resolveWorkspaceInit({
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

      const projectMetas = workspaceInit.workspace.skills.map((s) => ({
        description: s.description ?? '',
        identifier: `project:${s.name}`,
        location: s.path,
        name: s.name,
        source: 'project' as const,
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
      const seenNames = new Set<string>();
      const skills = [...projectMetas, ...dbMetas, ...agentSkillMetas, ...builtinMetas].filter(
        (skill) => {
          if (seenNames.has(skill.name)) return false;
          seenNames.add(skill.name);
          return true;
        },
      );

      const skillEngine = new SkillEngine({
        enableChecker: (skill) => shouldEnableBuiltinSkill(skill.identifier),
        skills,
      });
      operationSkillSet = skillEngine.generate(agentPlugins ?? []);
    } catch (error) {
      log('execAgent: failed to build operationSkillSet: %O', error);
    }

    // 19. Create operation using AgentRuntimeService
    log(
      'execAgent: creating operation %s — agentDocuments=%d, knowledgeBases=%s, tools=%d, skills=%d',
      operationId,
      hasAgentDocuments ? 'yes' : 0,
      hasEnabledKnowledgeBases,
      tools?.length ?? 0,
      operationSkillSet?.skills?.length ?? 0,
    );

    // Wrap in try-catch to handle operation startup failures (e.g., QStash unavailable)
    // If createOperation fails, we still have valid messages that need error info
    try {
      const result = await this.agentRuntimeService.createOperation({
        activeDeviceId,
        agentConfig,
        deviceSystemInfo: Object.keys(deviceSystemInfo).length > 0 ? deviceSystemInfo : undefined,
        executionPlan,
        userTimezone,
        appContext: {
          // Background self-iteration runs execute under a builtin slug (so they
          // inherit the builtin agent's tools / systemRole / model), but their
          // resource tools and receipts must attribute to the *reviewed* user
          // agent, which rides on the marker. Prefer it so the tool-execution
          // context (state.metadata.agentId) targets the reviewed agent; ordinary
          // runs (no marker) fall back to the resolved executing agent.
          agentId: appContext?.agentSignal?.agentId ?? resolvedAgentId,
          // When scope === 'agent_builder', agentId stays as the builder builtin so
          // message ownership and queryUiMessages remain correct. editingAgentId
          // carries the actual editing target separately; only the AgentBuilder server
          // runtime reads it, keeping the rest of the pipeline unaffected.
          ...(appContext?.scope === 'agent_builder' && appContext?.editingAgentId
            ? { editingAgentId: appContext.editingAgentId }
            : {}),
          // Run-scoped Agent Signal marker for background self-iteration / memory
          // runs — lands in state.metadata.agentSignal so the completion path can
          // project receipts/briefs. Undefined for ordinary chat runs.
          ...(appContext?.agentSignal ? { agentSignal: appContext.agentSignal } : {}),
          defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
          documentId: appContext?.documentId,
          groupId: appContext?.groupId,
          isSubAgent: appContext?.isSubAgent,
          scope: appContext?.scope,
          sourceMessageId: userMessageRecord?.id ?? parentMessageId ?? undefined,
          taskId: operationTaskId,
          threadId: appContext?.threadId,
          topicId,
          trigger,
        },
        autoStart,
        botContext,
        botPlatformContext,
        deviceAccessPolicy: { canUseDevice, reason: deviceAccessReason },
        discordContext,
        evalContext,
        initialContext,
        initialMessages: allMessages,
        initialStepCount,
        maxSteps,
        modelRuntimeConfig: { model, provider },
        hooks,
        operationId,
        parentOperationId,
        signal,
        queueRetries,
        queueRetryDelay,
        stream,
        toolSet: {
          enabledToolIds: toolsResult.enabledToolIds,
          executorMap: toolExecutorMap,
          manifestMap: toolManifestMap,
          sourceMap: toolSourceMap,
          tools,
        },
        operationSkillSet,
        userId: this.userId,
        userInterventionConfig,
        userMemory,
        workspaceId: this.workspaceId,
      });

      log('execAgent: created operation %s (autoStarted: %s)', operationId, result.autoStarted);

      // Persist running operation to topic metadata for reconnect after page reload
      await this.topicModel.updateMetadata(topicId, {
        runningOperation: {
          assistantMessageId: assistantMessageRecord.id,
          operationId,
          scope: appContext?.scope ?? undefined,
          threadId: appContext?.threadId ?? undefined,
        },
      });

      // Generate a short-lived JWT for Gateway WebSocket authentication
      let gatewayToken: string | undefined;
      try {
        gatewayToken = await signUserJWT(this.userId);
      } catch {
        log('execAgent: failed to sign gateway JWT, gateway auth will be unavailable');
      }

      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: result.autoStarted,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: result.messageId,
        operationId,
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        token: gatewayToken,
        topicId,
        userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
      };
    } catch (error) {
      if (isAbortError(error)) {
        await updateAbortedAssistantMessage(error.message);
        log('execAgent: createOperation aborted for %s: %s', operationId, error.message);
        throw error;
      }

      // Operation startup failed (e.g., QStash queue service unavailable)
      // Update assistant message with error so user can see what went wrong
      const errorMessage = error instanceof Error ? error.message : 'Unknown error starting agent';
      log(
        'execAgent: createOperation failed, updating assistant message with error: %s',
        errorMessage,
      );

      await this.messageModel.update(assistantMessageRecord.id, {
        content: '',
        error: {
          body: {
            detail: errorMessage,
          },
          message: errorMessage,
          type: 'ServerAgentRuntimeError', // ServiceUnavailable - agent runtime service unavailable
        },
      });

      // Return result with error status - messages are valid but agent didn't start
      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: errorMessage,
        message: 'Agent operation failed to start',
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
      };
    }
  }

  /**
   * Execute Group Agent (Supervisor) in a single call
   *
   * This method handles Group-specific logic (topic with groupId) and delegates
   * the core agent execution to execAgent.
   *
   * Flow:
   * 1. Create topic with groupId (if needed)
   * 2. Delegate to execAgent for the rest
   */
  async execGroupAgent(params: ExecGroupAgentParams): Promise<ExecGroupAgentResult> {
    const { agentId, groupId, message, topicId: inputTopicId, newTopic } = params;

    log(
      'execGroupAgent: agentId=%s, groupId=%s, message=%s',
      agentId,
      groupId,
      message.slice(0, 50),
    );

    // 1. Create topic with groupId if needed
    let topicId = inputTopicId;
    let isCreateNewTopic = false;

    // Create new topic when:
    // - newTopic is explicitly provided, OR
    // - no topicId is provided (default behavior for group chat)
    if (newTopic || !inputTopicId) {
      const fallbackTitleSource = markdownToTxt(message);
      const topicTitle =
        newTopic?.title ||
        fallbackTitleSource.slice(0, 50) + (fallbackTitleSource.length > 50 ? '...' : '');
      const topicItem = await this.topicModel.create({
        agentId,
        groupId,
        messages: newTopic?.topicMessageIds,
        title: topicTitle,
        // Note: execGroupAgent doesn't have trigger param yet, defaults to null
      });
      topicId = topicItem.id;
      isCreateNewTopic = true;
      log('execGroupAgent: created new topic %s with groupId %s', topicId, groupId);
    }

    // 2. Delegate to execAgent with groupId in appContext
    const result = await this.execAgent({
      agentId,
      appContext: { groupId, topicId },
      autoStart: true,
      prompt: message,
      trigger: RequestTrigger.Chat,
    });

    log(
      'execGroupAgent: delegated to execAgent, operationId=%s, success=%s',
      result.operationId,
      result.success,
    );

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      isCreateNewTopic,
      operationId: result.operationId,
      success: result.success,
      topicId: result.topicId,
      userMessageId: result.userMessageId,
    };
  }

  /**
   * Execute an agent in an isolated Thread context.
   *
   * Group/callAgent paths use this entry. It does not mark the child as a
   * virtual sub-agent and it does not install the async completion bridge.
   */
  // Arrow field (not a method) so it stays bound when handed to AgentRuntimeService.
  execSubAgent = async (params: ExecSubAgentParams): Promise<ExecSubAgentResult> =>
    this.execAgentThreadRun(params, {
      isSubAgent: false,
      logScope: 'execSubAgent',
    });

  /**
   * Execute a virtual sub-agent created by `lobe-agent.callSubAgent`.
   *
   * This path is a child operation of the current agent run. It is marked as a
   * sub-agent so it cannot recursively spawn more sub-agents, and it registers
   * the bridge that backfills the parent's placeholder tool message.
   */
  execVirtualSubAgent = async (params: ExecVirtualSubAgentParams): Promise<ExecSubAgentResult> =>
    this.execAgentThreadRun(params, {
      isSubAgent: true,
      logScope: 'execVirtualSubAgent',
      resumeParentOnComplete: true,
    });

  /**
   * Fork a single group member ("call agent member") under a `lobe-group-management`
   * tool call. Dispatches to the in-group (non-isolated, shared group session)
   * or isolated (own thread) path, installing the group-action member completion
   * bridge. Invoked once per member by the runtime's `agentMember` runner.
   *
   * Arrow field (not a method) so it stays bound when handed to the runtime
   * delegate.
   */
  execGroupMember = async (params: ExecGroupMemberParams): Promise<ExecGroupMemberResult> => {
    if (params.mode === 'isolated') {
      // Isolated members reuse the sub-agent isolation-thread machinery, swapping
      // in the group-action member bridge (K=N barrier + resume/finish).
      const result = await this.execAgentThreadRun(
        {
          agentId: params.agentId,
          groupId: params.groupId,
          instruction: params.instruction ?? 'Please complete the assigned task.',
          parentMessageId: params.anchorMessageId,
          parentOperationId: params.parentOperationId,
          timeout: params.timeout,
          title: params.instruction?.slice(0, 50),
          topicId: params.topicId,
        },
        {
          bridgeHookFactory: (threadId) =>
            this.createGroupActionMemberBridgeHook({
              anchorMessageId: params.anchorMessageId,
              expectedMembers: params.expectedMembers,
              groupToolMessageId: params.groupToolMessageId,
              mode: 'isolated',
              onComplete: params.onComplete,
              parentOperationId: params.parentOperationId,
              threadId,
            }),
          isSubAgent: true,
          logScope: 'execVirtualSubAgent',
          resumeParentOnComplete: true,
        },
      );

      // Enforce the requested timeout: if the member op is still running when the
      // deadline passes, the watchdog interrupts it and bridges a `timeout`
      // completion so the supervisor doesn't stay parked indefinitely.
      if (result.success && result.operationId && params.timeout && params.timeout > 0) {
        await this.agentRuntimeService.scheduleGroupMemberTimeout(
          {
            anchorMessageId: params.anchorMessageId,
            expectedMembers: params.expectedMembers,
            groupToolMessageId: params.groupToolMessageId,
            memberOperationId: result.operationId,
            mode: 'isolated',
            onComplete: params.onComplete,
            parentOperationId: params.parentOperationId,
          },
          params.timeout,
        );
      }

      return {
        error: result.error,
        operationId: result.operationId,
        started: result.success ?? false,
        threadId: result.threadId,
      };
    }

    return this.execAgentMember(params);
  };

  /**
   * Run a group member in the shared group session (non-isolated). The member's
   * turns land directly in the group conversation; the supervisor's instruction
   * is injected as a `<speaker name="Supervisor" />`-tagged prompt. Registers the
   * group-action member bridge that backfills the member anchor and
   * resumes/finishes the parked supervisor once the K=N member barrier passes.
   */
  private async execAgentMember(params: ExecGroupMemberParams): Promise<ExecGroupMemberResult> {
    const {
      agentId,
      anchorMessageId,
      disableTools,
      expectedMembers,
      groupId,
      groupToolMessageId,
      instruction,
      onComplete,
      parentOperationId,
      topicId,
    } = params;

    log(
      'execAgentMember: agentId=%s, groupId=%s, topicId=%s, instruction=%s',
      agentId,
      groupId,
      topicId,
      (instruction ?? '').slice(0, 50),
    );

    // Dispatch beforeCallAgent hook on the supervisor operation.
    hookDispatcher
      .dispatch(parentOperationId, 'beforeCallAgent', {
        agentId,
        instruction: (instruction ?? '').slice(0, 200),
        operationId: parentOperationId,
        userId: this.userId,
      })
      .catch(() => {});

    // Inherit the supervisor op's trigger so member rows stay attributable.
    let inheritedTrigger: string | undefined;
    try {
      const parentOp = await this.agentOperationModel.findById(parentOperationId);
      inheritedTrigger = parentOp?.trigger ?? undefined;
    } catch (error) {
      log('execAgentMember: failed to read parent operation trigger: %O', error);
    }

    const speakerInstruction = instruction
      ? `<speaker name="Supervisor" />\n${instruction}`
      : 'Please respond to the group conversation based on the current context.';

    const appContext: NonNullable<InternalExecAgentParams['appContext']> = {
      groupId,
      scope: 'group',
      topicId,
    };

    // The member runs as a child op of the supervisor and lands its turns in the
    // shared group conversation (no isolation thread). The bridge backfills the
    // member anchor (a short receipt) and resumes/finishes the supervisor.
    //
    // The supervisor instruction is injected as an EPHEMERAL user message
    // (`suppressUserMessage` + `ephemeralUserMessage`): it drives the member's
    // response but is NOT persisted as a `role: 'user'` row, mirroring the
    // client orchestration where the supervisor instruction is virtual. Without
    // this, every server-side speak/broadcast/delegate would leak the
    // orchestration prompt into the group conversation as a real message.
    const result = await this.execAgent({
      agentId,
      appContext,
      autoStart: true,
      disableTools,
      ephemeralUserMessage: speakerInstruction,
      hooks: [
        this.createGroupActionMemberBridgeHook({
          anchorMessageId,
          expectedMembers,
          groupToolMessageId,
          mode: 'in_group',
          onComplete,
          parentOperationId,
        }),
      ],
      parentMessageId: anchorMessageId,
      parentOperationId,
      prompt: speakerInstruction,
      suppressUserMessage: true,
      trigger: inheritedTrigger,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    log(
      'execAgentMember: delegated to execAgent, operationId=%s, success=%s',
      result.operationId,
      result.success,
    );

    return {
      error: result.error,
      operationId: result.operationId,
      started: result.success ?? false,
    };
  }

  private async execAgentThreadRun(
    params: ExecSubAgentParams | ExecVirtualSubAgentParams,
    options: {
      /**
       * Override the default sub-agent completion bridge with a custom hook
       * (e.g. the group-action member bridge for isolated executeAgentTask(s)).
       * Receives the freshly-created isolation thread id. Only used when
       * `resumeParentOnComplete` is set.
       */
      bridgeHookFactory?: (threadId: string) => AgentHook;
      isSubAgent: boolean;
      logScope: 'execSubAgent' | 'execVirtualSubAgent';
      resumeParentOnComplete?: boolean;
    },
  ): Promise<ExecSubAgentResult> {
    const { groupId, topicId, parentMessageId, agentId, instruction, title, parentOperationId } =
      params;

    log(
      '%s: agentId=%s, groupId=%s, topicId=%s, instruction=%s',
      options.logScope,
      agentId,
      groupId,
      topicId,
      instruction.slice(0, 50),
    );

    // Dispatch beforeCallAgent hook on parent operation
    if (parentOperationId) {
      hookDispatcher
        .dispatch(parentOperationId, 'beforeCallAgent', {
          agentId,
          instruction: instruction.slice(0, 200),
          operationId: parentOperationId,
          userId: this.userId,
        })
        .catch(() => {});
    }

    // 1. Create Thread for isolated agent execution
    const thread = await this.threadModel.create({
      agentId,
      groupId,
      sourceMessageId: parentMessageId,
      title,
      topicId,
      type: ThreadType.Isolation,
    });

    if (!thread) {
      throw new Error('Failed to create thread for agent execution');
    }

    log('%s: created thread %s', options.logScope, thread.id);

    // 2. Update Thread status to processing with startedAt timestamp
    const startedAt = new Date().toISOString();
    await this.threadModel.update(thread.id, {
      metadata: { startedAt },
      status: ThreadStatus.Processing,
    });

    // 3. Create hooks for updating Thread metadata and source message
    const threadHooks = this.createThreadHooks(
      thread.id,
      startedAt,
      parentMessageId,
      options.logScope,
    );
    // For the virtual sub-agent path, also register the completion bridge that
    // backfills the parent's placeholder tool message and resumes the parked
    // parent op once the child run is done. Registered last so its tool-message
    // backfill (content + pluginState) is the final write.
    const hooks =
      options.resumeParentOnComplete && parentOperationId
        ? [
            ...threadHooks,
            options.bridgeHookFactory
              ? options.bridgeHookFactory(thread.id)
              : this.createSubAgentBridgeHook(parentOperationId, parentMessageId, thread.id),
          ]
        : threadHooks;

    // Inherit parent op's trigger so sub-agent rows stay attributable to the
    // original entry point (chat / bot / cli / eval / …). Lookup is best-effort
    // — a missing parent row falls back to undefined and the column stays null.
    let inheritedTrigger: string | undefined;
    if (parentOperationId) {
      try {
        const parentOp = await this.agentOperationModel.findById(parentOperationId);
        inheritedTrigger = parentOp?.trigger ?? undefined;
      } catch (error) {
        log('%s: failed to read parent operation trigger: %O', options.logScope, error);
      }
    }

    const appContext: NonNullable<InternalExecAgentParams['appContext']> = {
      groupId,
      isSubAgent: options.isSubAgent,
      threadId: thread.id,
      topicId,
    };

    // 4. Delegate to execAgent with threadId in appContext and hooks
    // The instruction will be created as user message in the Thread
    // Use headless mode to skip human approval in async agent execution
    const result = await this.execAgent({
      agentId,
      appContext,
      autoStart: true,
      hooks,
      parentOperationId,
      prompt: instruction,
      trigger: inheritedTrigger,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    log(
      '%s: delegated to execAgent, operationId=%s, success=%s',
      options.logScope,
      result.operationId,
      result.success,
    );

    // 5. Store operationId in Thread metadata
    await this.threadModel.update(thread.id, {
      metadata: { operationId: result.operationId, startedAt },
    });

    // 6. If operation failed to start, update thread status
    if (!result.success) {
      const completedAt = new Date().toISOString();
      await this.threadModel.update(thread.id, {
        metadata: {
          completedAt,
          duration: Date.now() - new Date(startedAt).getTime(),
          error: result.error,
          operationId: result.operationId,
          startedAt,
        },
        status: ThreadStatus.Failed,
      });

      // Dispatch onCallAgentError hook
      if (parentOperationId) {
        hookDispatcher
          .dispatch(parentOperationId, 'onCallAgentError', {
            agentId,
            error: result.error || 'Sub-agent execution failed',
            operationId: parentOperationId,
            userId: this.userId,
          })
          .catch(() => {});
      }
    } else if (parentOperationId) {
      // Dispatch afterCallAgent hook
      hookDispatcher
        .dispatch(parentOperationId, 'afterCallAgent', {
          agentId,
          operationId: parentOperationId,
          subOperationId: result.operationId,
          success: true,
          threadId: thread.id,
          userId: this.userId,
        })
        .catch(() => {});
    }

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      operationId: result.operationId,
      success: result.success ?? false,
      threadId: thread.id,
    };
  }

  /**
   * Create step lifecycle callbacks for updating Thread metadata
   * These callbacks accumulate metrics during execution and update Thread on completion
   *
   * @param threadId - The Thread ID to update
   * @param startedAt - The start time ISO string
   * @param sourceMessageId - The source message ID from Thread to update with summary
   */
  private createThreadMetadataCallbacks(
    threadId: string,
    startedAt: string,
    sourceMessageId: string,
    logScope: 'execSubAgent' | 'execVirtualSubAgent' = 'execSubAgent',
  ): StepLifecycleCallbacks {
    // Accumulator for tracking metrics across steps
    let accumulatedToolCalls = 0;

    return {
      onAfterStep: async ({ state, stepResult }) => {
        // Count tool calls from this step
        const toolCallsInStep = stepResult?.events?.filter(
          (e: { type: string }) => e.type === 'tool_call',
        )?.length;
        if (toolCallsInStep) {
          accumulatedToolCalls += toolCallsInStep;
        }

        // Update Thread metadata with current progress
        try {
          await this.threadModel.update(threadId, {
            metadata: {
              operationId: state.operationId,
              startedAt,
              totalMessages: state.messages?.length ?? 0,
              totalTokens: this.calculateTotalTokens(state.usage),
              totalToolCalls: accumulatedToolCalls,
            },
          });
          log('%s: updated thread %s metadata after step %d', logScope, threadId, state.stepCount);
        } catch (error) {
          log('%s: failed to update thread metadata: %O', logScope, error);
        }
      },

      onComplete: async ({ finalState, reason }) => {
        const completedAt = new Date().toISOString();
        const duration = Date.now() - new Date(startedAt).getTime();

        // Determine thread status based on completion reason
        let status: ThreadStatus;
        switch (reason) {
          case 'done': {
            status = ThreadStatus.Completed;
            break;
          }
          case 'error': {
            status = ThreadStatus.Failed;
            break;
          }
          case 'interrupted': {
            status = ThreadStatus.Cancel;
            break;
          }
          case 'waiting_for_human': {
            status = ThreadStatus.InReview;
            break;
          }
          default: {
            status = ThreadStatus.Completed;
          }
        }

        // Log error when the isolated run fails
        if (reason === 'error' && finalState.error) {
          console.error('%s: run failed for thread %s:', logScope, threadId, finalState.error);
        }

        try {
          // Extract summary from last assistant message and update source message content
          const lastAssistantMessage = finalState.messages
            ?.slice()
            .reverse()
            .find((m: { role: string }) => m.role === 'assistant');

          if (lastAssistantMessage?.content) {
            await this.messageModel.update(sourceMessageId, {
              content: lastAssistantMessage.content,
            });
            log('%s: updated source message %s with summary', logScope, sourceMessageId);
          }

          // Format error for proper serialization (Error objects don't serialize with JSON.stringify)
          const formattedError = formatErrorForMetadata(finalState.error);

          // Update Thread metadata
          await this.threadModel.update(threadId, {
            metadata: {
              completedAt,
              duration,
              error: formattedError,
              operationId: finalState.operationId,
              startedAt,
              totalCost: finalState.cost?.total,
              totalMessages: finalState.messages?.length ?? 0,
              totalTokens: this.calculateTotalTokens(finalState.usage),
              totalToolCalls: accumulatedToolCalls,
            },
            status,
          });

          log(
            '%s: thread %s completed with status %s, reason: %s',
            logScope,
            threadId,
            status,
            reason,
          );
        } catch (error) {
          console.error('%s: failed to update thread on completion: %O', logScope, error);
        }
      },
    };
  }

  /**
   * Create hooks for tracking Thread metadata updates during SubAgent execution.
   * Replaces the legacy createThreadMetadataCallbacks with the hooks system.
   */
  private createThreadHooks(
    threadId: string,
    startedAt: string,
    sourceMessageId: string,
    logScope: 'execSubAgent' | 'execVirtualSubAgent',
  ): AgentHook[] {
    let accumulatedToolCalls = 0;

    return [
      {
        handler: async (event) => {
          const state = event.finalState;
          if (!state) return;

          // Count tool calls from step result
          const stepToolCalls = state.session?.toolCalls || 0;
          if (stepToolCalls > accumulatedToolCalls) {
            accumulatedToolCalls = stepToolCalls;
          }

          try {
            await this.threadModel.update(threadId, {
              metadata: {
                operationId: event.operationId,
                startedAt,
                totalMessages: state.messages?.length ?? 0,
                totalTokens: this.calculateTotalTokens(state.usage),
                totalToolCalls: accumulatedToolCalls,
              },
            });
          } catch (error) {
            log('%s: thread hook afterStep failed to update metadata: %O', logScope, error);
          }
        },
        id: 'thread-metadata-update',
        type: 'afterStep' as const,
      },
      {
        handler: async (event) => {
          const finalState = event.finalState;
          if (!finalState) return;

          const completedAt = new Date().toISOString();
          const duration = Date.now() - new Date(startedAt).getTime();

          // Map completion reason to ThreadStatus
          let status: ThreadStatus;
          switch (event.reason) {
            case 'done': {
              status = ThreadStatus.Completed;
              break;
            }
            case 'error': {
              status = ThreadStatus.Failed;
              break;
            }
            case 'interrupted': {
              status = ThreadStatus.Cancel;
              break;
            }
            case 'waiting_for_human': {
              status = ThreadStatus.InReview;
              break;
            }
            default: {
              status = ThreadStatus.Completed;
            }
          }

          if (event.reason === 'error' && finalState.error) {
            console.error(
              '%s: thread hook onComplete run failed for thread %s:',
              logScope,
              threadId,
              finalState.error,
            );
          }

          try {
            // Update source message with summary
            const lastAssistantMessage = finalState.messages
              ?.slice()
              .reverse()
              .find((m: { role: string }) => m.role === 'assistant');

            if (lastAssistantMessage?.content) {
              await this.messageModel.update(sourceMessageId, {
                content: lastAssistantMessage.content,
              });
            }

            const formattedError = formatErrorForMetadata(finalState.error);

            await this.threadModel.update(threadId, {
              metadata: {
                completedAt,
                duration,
                error: formattedError,
                operationId: finalState.operationId,
                startedAt,
                totalCost: finalState.cost?.total,
                totalMessages: finalState.messages?.length ?? 0,
                totalTokens: this.calculateTotalTokens(finalState.usage),
                totalToolCalls: accumulatedToolCalls,
              },
              status,
            });

            log(
              '%s: thread hook onComplete thread %s status=%s reason=%s',
              logScope,
              threadId,
              status,
              event.reason,
            );
          } catch (error) {
            console.error('%s: thread hook onComplete failed to update: %O', logScope, error);
          }
        },
        id: 'thread-completion',
        type: 'onComplete' as const,
      },
    ];
  }

  /**
   * Completion bridge for the server `callSubAgent` deferred-tool path.
   *
   * Fires on the sub-op's completion (success or failure) and delegates to
   * `AgentRuntimeService.completeSubAgentBridge`: backfill the parent's
   * placeholder tool message, then barrier-check + CAS-resume the parked
   * parent op.
   *
   * Transport adapts to the runtime mode like every other lifecycle hook:
   *   - local mode: the `handler` runs in-process with the child's finalState.
   *   - queue mode: in-memory handlers don't survive cross-process steps, so
   *     the serialized `webhook` config is delivered via QStash to
   *     `/api/agent/webhooks/subagent-callback`, which re-enters the same
   *     bridge method. `delivery: 'qstash'` is required — a plain fetch would
   *     be rejected by the endpoint's QStash signature auth.
   */
  private createSubAgentBridgeHook(
    parentOperationId: string,
    toolMessageId: string,
    threadId: string,
  ): AgentHook {
    return {
      handler: async (event) => {
        try {
          await this.agentRuntimeService.completeSubAgentBridge({
            finalState: event.finalState,
            operationId: event.operationId,
            parentOperationId,
            reason: event.reason ?? 'done',
            threadId,
            toolMessageId,
          });
        } catch (error) {
          console.error(
            'Sub-agent bridge: failed to complete bridge for parent %s: %O',
            parentOperationId,
            error,
          );
        }
      },
      id: 'sub-agent-bridge',
      type: 'onComplete' as const,
      webhook: {
        body: { parentOperationId, threadId, toolMessageId },
        delivery: 'qstash' as const,
        // Keep the payload lean: the endpoint reloads the child's final state
        // from the coordinator, so everything beyond these ids is dead weight.
        // The default (all event fields) would ship the child's entire final
        // answer (`lastAssistantContent`) — and any tool-produced attachments
        // the shared lifecycle event extractor inlines — through QStash.
        eventFields: ['operationId', 'reason', 'status'],
        // The endpoint sits behind QStash signature auth, so the unsigned
        // fetch fallback could never authenticate — it would only mask a
        // publish failure as a silently-dropped 401, stranding the parent.
        fallback: 'none' as const,
        url: '/api/agent/webhooks/subagent-callback',
      },
    };
  }

  /**
   * Completion bridge for the group orchestration "call agent member" path.
   *
   * Fires on a member op's completion and delegates to
   * `AgentRuntimeService.completeGroupActionMember`: backfill the member anchor,
   * enforce the K=N member barrier, then resume/finish the parked supervisor.
   * Transport mirrors {@link createSubAgentBridgeHook} — in-process in local
   * mode, QStash → `/api/agent/webhooks/group-member-callback` in queue mode.
   */
  private createGroupActionMemberBridgeHook(params: {
    anchorMessageId: string;
    expectedMembers: number;
    groupToolMessageId: string;
    mode: GroupActionMemberMode;
    onComplete: GroupActionOnComplete;
    parentOperationId: string;
    threadId?: string;
  }): AgentHook {
    const {
      anchorMessageId,
      expectedMembers,
      groupToolMessageId,
      mode,
      onComplete,
      parentOperationId,
      threadId,
    } = params;
    return {
      handler: async (event) => {
        try {
          await this.agentRuntimeService.completeGroupActionMember({
            anchorMessageId,
            expectedMembers,
            finalState: event.finalState,
            groupToolMessageId,
            mode,
            onComplete,
            operationId: event.operationId,
            parentOperationId,
            reason: event.reason ?? 'done',
            threadId,
          });
        } catch (error) {
          console.error(
            'Group-member bridge: failed to complete bridge for parent %s: %O',
            parentOperationId,
            error,
          );
        }
      },
      id: 'group-member-bridge',
      type: 'onComplete' as const,
      webhook: {
        body: {
          anchorMessageId,
          expectedMembers,
          groupToolMessageId,
          mode,
          onComplete,
          parentOperationId,
          threadId,
        },
        delivery: 'qstash' as const,
        eventFields: ['operationId', 'reason', 'status'],
        fallback: 'none' as const,
        url: '/api/agent/webhooks/group-member-callback',
      },
    };
  }

  /**
   * Calculate total tokens from AgentState usage object
   * AgentState.usage is of type Usage from @lobechat/agent-runtime
   */
  private calculateTotalTokens(usage?: AgentState['usage']): number | undefined {
    if (!usage) return undefined;
    return usage.llm?.tokens?.total;
  }

  /**
   * Interrupt a running task
   *
   * This method interrupts a SubAgent task by threadId or operationId.
   * It updates both operation status and Thread status to cancelled state.
   */
  async interruptTask(params: {
    operationId?: string;
    threadId?: string;
    topicId?: string;
  }): Promise<{ operationId?: string; success: boolean; threadId?: string }> {
    const { threadId, operationId, topicId } = params;

    log('interruptTask: threadId=%s, operationId=%s', threadId, operationId);

    // 1. Get operationId and thread
    let resolvedOperationId = operationId;
    let thread;

    if (threadId) {
      thread = await this.threadModel.findById(threadId);
      if (!thread) {
        throw new Error('Thread not found');
      }
      resolvedOperationId = resolvedOperationId || thread.metadata?.operationId;
    }

    if (!resolvedOperationId) {
      throw new Error('Operation ID not found');
    }

    // 2. Cancel remote hetero process (openclaw / hermes) if applicable.
    // Check topic.metadata.runningOperation for device + heteroType info seeded by execAgent.
    // This runs regardless of whether interruptOperation succeeds — the remote process
    // is independent of the local operation registry.
    if (topicId) {
      const topic = await this.topicModel.findById(topicId);
      const runningOp = (topic?.metadata as any)?.runningOperation as
        | { deviceId?: string; heteroType?: string; operationId?: string }
        | undefined;

      if (
        runningOp?.deviceId &&
        runningOp.heteroType &&
        isRemoteHeterogeneousType(runningOp.heteroType)
      ) {
        const taskId = runningOp.operationId ?? resolvedOperationId;
        log(
          'interruptTask: cancelling remote hetero process heteroType=%s deviceId=%s taskId=%s',
          runningOp.heteroType,
          runningOp.deviceId,
          taskId,
        );
        const cancelWorkspaceId = await this.resolveDeviceWorkspaceId(runningOp.deviceId);
        await deviceGateway
          .executeToolCall(
            {
              deviceId: runningOp.deviceId,
              userId: this.userId,
              workspaceId: cancelWorkspaceId,
            },
            {
              apiName: 'cancelHeteroTask',
              arguments: JSON.stringify({ signal: 'SIGINT', taskId }),
              identifier: 'cancelHeteroTask',
            },
            5_000,
          )
          .catch((err) => log('interruptTask: cancelHeteroTask dispatch failed: %O', err));
      }
    }

    // 3. Interrupt the runtime operation first. Only mark the thread cancelled
    // after the runtime acknowledges the interrupt to avoid unlocking a live task.
    const interrupted = await this.agentRuntimeService.interruptOperation(resolvedOperationId);
    log(
      'interruptTask: interruptOperation=%s for operationId=%s',
      interrupted,
      resolvedOperationId,
    );

    if (!interrupted) {
      const alreadyCancelled = thread?.status === ThreadStatus.Cancel;

      return {
        operationId: resolvedOperationId,
        success: alreadyCancelled,
        threadId: thread?.id,
      };
    }

    // 4. Update Thread status to cancel
    if (thread) {
      await this.threadModel.update(thread.id, {
        metadata: {
          ...thread.metadata,
          completedAt: new Date().toISOString(),
        },
        status: ThreadStatus.Cancel,
      });
    }

    return {
      operationId: resolvedOperationId,
      success: true,
      threadId: thread?.id,
    };
  }
}
