import type {
  Agent,
  AgentRuntimeContext,
  AgentState,
  GeneralAgentConfig,
} from '@lobechat/agent-runtime';
import {
  extractActivatedToolIdsFromMessages,
  GeneralChatAgent,
  GraphAgent,
} from '@lobechat/agent-runtime';
import {
  BUILTIN_AGENT_SLUGS,
  getAgentRuntimeConfig,
  isCollaborativeBuiltinAgentRow,
} from '@lobechat/builtin-agents';
import { builtinSkills } from '@lobechat/builtin-skills';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { GoalIdentifier, isGoalPrompt } from '@lobechat/builtin-tool-goal';
import { LobeAgentIdentifier, LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { getShellSyntaxGuidance, LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
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
import {
  isHeterogeneousAgentModelId,
  LOADING_FLAT,
  resolveSubAgentChatConfig,
} from '@lobechat/const';
import {
  type AgentGroupConfig,
  type AgentManagementContext,
  type BotPlatformContext,
  buildExpertiseContextSnapshot,
  type LobeToolManifest,
  SkillEngine,
  type ToolExecutor,
  type ToolsEngine,
  type ToolSource,
} from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import {
  getHeterogeneousAgentConfig,
  HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
  isLocalHeterogeneousType,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { buildTaskManagerDefaultsPrompt, resourcesTreePrompt } from '@lobechat/prompts';
import type {
  AgentModelOverride,
  ChatAudioItem,
  ChatFileItem,
  ChatTopicBotContext,
  ChatVideoItem,
  ErrorType,
  ExecAgentParams,
  ExecAgentResult,
  ExecGroupAgentParams,
  ExecGroupAgentResult,
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
  HeterogeneousTopicModel,
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  LobeAgentConfig,
  MessagePluginItem,
  RuntimeMentionedAgent,
  ScheduleAgentRunParams,
  ScheduleAgentRunResult,
  UserInterventionConfig,
  WorkingDirConfig,
  WorkspaceInitResult,
} from '@lobechat/types';
import {
  AgentGraphSchema,
  applyTopicModelToHeterogeneousProvider,
  buildHeteroExecArgs,
  ChatErrorType,
  getActivePluginIds,
  getDisabledPluginIds,
  getWorkingDirEffectivePath,
  RequestTrigger,
  resolveAgentAgencyConfig,
  resolveAgentModelConfig,
  resolveHeterogeneousProviderTopicModel,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { isRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import type { ModelAbilities } from 'model-bank';

import {
  deriveAgentInterventionContinuationMessageId,
  deriveAgentInterventionContinuationOperationId,
  deriveAgentInterventionQueueDeduplicationId,
  matchesAgentInterventionContinuationProvenance,
} from '@/business/server/agent-run/agentInterventionIdentity';
import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { AiModelModel } from '@/database/models/aiModel';
import { AiProviderModel } from '@/database/models/aiProvider';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { DeviceModel } from '@/database/models/device';
import { ExpertiseModel } from '@/database/models/expertise';
import { FileModel } from '@/database/models/file';
import {
  HumanApprovalAlreadyResolvedError,
  type HumanApprovalResolution,
  MessageModel,
} from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TaskModel } from '@/database/models/task';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import { toolsEnv } from '@/envs/tools';
import {
  type ExecutionPlan,
  executionPlanToManifestExecutionEnv,
  executionTargetToRuntimeMode,
  isDeviceCapablePlan,
  isDeviceLockedPlan,
  resolveExecutionPlan,
  resolveToolMode,
  resolveWorkspaceScoped,
} from '@/helpers/executionTarget';
import { shouldEnableBuiltinSkill } from '@/helpers/skillFilters';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { patchManifestWithPermissions } from '@/libs/mcp/connectorPermissionCheck';
import { signHeteroOperationJWT, signUserJWT } from '@/libs/trpc/utils/internalJwt';
import {
  createAgentStateManager,
  createStreamEventManager,
} from '@/server/modules/AgentRuntime/factory';
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
  EvalRuntimeContext,
  SubAgentBridgeParams,
} from '@/server/services/agentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { getAbortError, isAbortError, throwIfAborted } from '@/server/services/agentRuntime/abort';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
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
import { platformRegistry } from '@/server/services/bot/platforms';
import { ComposioService } from '@/server/services/composio';
import {
  buildLastSyncedAtMap,
  scheduleStaleConnectorToolsRefresh,
} from '@/server/services/connector/refresh';
import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { resolveAttachmentsByFileIds } from '@/server/services/file/resolveAttachments';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';
import type { ConversationHistoryEntry } from '@/server/services/heterogeneousAgent/cloudHeteroContext';
import { buildCloudHeteroContext } from '@/server/services/heterogeneousAgent/cloudHeteroContext';
import { buildRemoteDeviceHeteroContext } from '@/server/services/heterogeneousAgent/remoteDeviceHeteroContext';
import { MarketService } from '@/server/services/market';
import { isResourceAuthorOrAdmin } from '@/server/services/resourcePermission';
import {
  buildConnectorOwnershipPrompt,
  collectBorrowedConnectors,
  resolveUserDisplayMap,
} from '@/server/utils/connectorAttribution';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { resolveDeviceAccessPolicy } from './deviceAccessPolicy';
import {
  buildAllowedBuiltinTools,
  isDeviceToolIdentifier,
  REMOTE_DEVICE_TOOL_IDENTIFIERS,
} from './deviceToolRegistry';
import { ingestAttachment } from './ingestAttachment';
import { pruneRegeneratedBranch } from './pruneRegeneratedBranch';
import { resolveDeviceWorkingDirectoryConfig } from './resolveDeviceWorkingDirectory';
import { resolveServerSearchDecision } from './searchDecision';
import { acquireTopicStartReservation } from './topicStartReservation';
import { isWorkspaceCacheFresh, upsertWorkspaceScan } from './workspaceInitCache';

const log = debug('lobe-server:ai-agent-service');

const supportsCloudHeterogeneousSandbox = (type: HeterogeneousAgentType): boolean =>
  type === 'claude-code' || type === 'codex';

const getHeterogeneousAgentTitle = (type: HeterogeneousAgentType): string =>
  getHeterogeneousAgentConfig(type)?.title ?? type;

/**
 * Content written onto a tool row that the user stopped before it ran. Mirrors
 * the runtime's aborted-tool wording so a stopped call reads the same whether
 * it was settled here or by `resolve_aborted_tools`.
 */
const STOPPED_TOOL_CONTENT = 'Tool execution was aborted by user.';

const createGraphAwareAgentFactory =
  (
    upstreamFactory?: AgentRuntimeServiceOptions['agentFactory'],
  ): ((config: GeneralAgentConfig) => Agent) =>
  (config) => {
    if (upstreamFactory) {
      return upstreamFactory(config);
    }

    const runtimeAgentConfig = config.agentConfig as LobeAgentConfig | undefined;
    // Graph Agent is an agency-level behavior: read from `agencyConfig`.
    // Legacy rows stored the graph on `chatConfig` — fall back so existing
    // agents keep running until their next write migrates them.
    const agencyConfig = runtimeAgentConfig?.agencyConfig;
    const legacyChatConfig = runtimeAgentConfig?.chatConfig as
      (LobeAgentChatConfig & { enableGraphMode?: boolean; graph?: unknown }) | undefined;
    const graph = agencyConfig?.graph ?? legacyChatConfig?.graph;
    const graphEnabled =
      (agencyConfig?.enableGraphMode ?? legacyChatConfig?.enableGraphMode) === true;
    if (graphEnabled && graph) {
      const graphResult = AgentGraphSchema.safeParse(graph);

      if (graphResult.success) {
        return new GraphAgent({ ...config, graph: graphResult.data });
      }

      log('Invalid graph agent snapshot, falling back to default runtime: %O', graphResult.error);
    }

    return new GeneralChatAgent(config);
  };

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

const getMediaAvailabilityFromFileTypes = (fileTypes: string[]) => ({
  hasAudios: fileTypes.some((fileType) => fileType.startsWith('audio')),
  hasImages: fileTypes.some((fileType) => fileType.startsWith('image')),
  hasVideos: fileTypes.some((fileType) => fileType.startsWith('video')),
});

interface MediaAvailabilityMessage {
  audioList?: unknown[];
  imageList?: unknown[];
  role?: string;
  videoList?: unknown[];
}

const getMediaAvailabilityFromMessages = (messages: MediaAvailabilityMessage[]) => ({
  hasAudios: messages.some(
    (message) => message.role === 'user' && (message.audioList?.length ?? 0) > 0,
  ),
  hasImages: messages.some(
    (message) => message.role === 'user' && (message.imageList?.length ?? 0) > 0,
  ),
  hasVideos: messages.some(
    (message) => message.role === 'user' && (message.videoList?.length ?? 0) > 0,
  ),
});

const isMultimodalUnderstandingConfigured = () => {
  try {
    return (
      !!toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER && !!toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL
    );
  } catch {
    // The env proxy rejects server-only keys in client-like runtimes; treat that as disabled.
    return false;
  }
};

/**
 * Build the multi-agent group context from a group's member roster, mirroring
 * the client `contextEngineering.ts` `agentGroup` build. Carries every member's
 * real `agt_*` ID so the supervisor dispatches members by ID instead of role
 * name (role names don't resolve → "Agent member(s) failed to start."). Resolves
 * the responding agent's own role/name so GroupContextInjector marks it with
 * `you="true"` and the orchestration filter activates for participants.
 */
const buildGroupAgentContext = (
  currentAgentId: string,
  group: { content?: string | null; title?: string | null } | undefined,
  roster: Array<{ agentId: string; role: string | null; title: string | null }>,
): AgentGroupConfig | undefined => {
  if (roster.length === 0) return undefined;

  const agentMap: AgentGroupConfig['agentMap'] = {};
  const members: NonNullable<AgentGroupConfig['members']> = [];
  let currentAgentName: string | undefined;
  let currentAgentRole: 'supervisor' | 'participant' | undefined;

  for (const member of roster) {
    const role = member.role === 'supervisor' ? 'supervisor' : 'participant';
    const name = member.title?.trim() || 'Untitled Agent';
    agentMap[member.agentId] = { name, role };
    members.push({ id: member.agentId, name, role });

    if (member.agentId === currentAgentId) {
      currentAgentName = name;
      currentAgentRole = role;
    }
  }

  return {
    agentMap,
    currentAgentId,
    currentAgentName,
    currentAgentRole,
    groupTitle: group?.title || undefined,
    members,
    systemPrompt: group?.content || undefined,
  };
};

/**
 * Bot-conversation fallback: a single bot agent has no real group, so build a
 * degenerate one-member context purely to give it its `<group_context>`
 * identity block. Only used when there is no `groupId`.
 */
const buildBotConversationGroupContext = (
  currentAgentId: string,
  agentConfig: { description?: unknown; title?: unknown } | undefined,
): AgentGroupConfig => {
  const title = agentConfig?.title;
  const description = agentConfig?.description;
  const name = typeof title === 'string' && title.trim() ? title.trim() : 'Current Agent';

  return {
    agentMap: { [currentAgentId]: { name, role: 'participant' } },
    currentAgentId,
    currentAgentName: name,
    currentAgentRole: 'participant',
    members: [{ id: currentAgentId, name, role: 'participant' }],
    systemPrompt: typeof description === 'string' ? description : undefined,
  };
};

/**
 * Internal params for execAgent with step lifecycle callbacks
 * This extends the public ExecAgentParams with server-side only options
 */
interface InternalExecAgentParams extends ExecAgentParams {
  /** Additional plugin IDs to inject (e.g., task tool during task execution) */
  additionalPluginIds?: string[];
  /**
   * Server-authored generic intervention claim id. When present, the message
   * claim stores this exact id so a retry after dispatch-but-before-publish can
   * prove the runtime side effect already happened. Never client-passable.
   */
  approvalResolutionRequestId?: string;
  /**
   * Server-authored parked operation expected on every claimed tool row. Used
   * to retire its Redis/agent_operations lifecycle only after the replacement
   * continuation has been scheduled. Never client-passable.
   */
  approvalSourceOperationId?: string;
  /** Bot context for topic metadata (platform, applicationId, platformThreadId) */
  botContext?: ChatTopicBotContext;
  /** Bot platform context for injecting platform capabilities (e.g. markdown support) */
  botPlatformContext?: BotPlatformContext;
  /**
   * chatConfig overrides (thinking / reasoning-effort extend params) merged over
   * the executing agent's own chatConfig, skipping nulled keys. Internal-only:
   * set by the callSubAgent thread-run path, never client-passable.
   */
  chatConfigOverride?: Partial<LobeAgentChatConfig> | null;
  /**
   * Thread `execAgent` materialised from `appContext.newThread` for THIS turn.
   * Internal-only: set by the wrapper after it creates the row, never
   * client-passable. Tells the turn its thread is brand new, so the first
   * message anchors on the branch point instead of a (non-existent) spine head.
   */
  createdThreadId?: string;
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
  /** Eval execution controls, such as fixture tool forwarding. */
  evalRuntime?: EvalRuntimeContext;
  /**
   * Restrict this orchestration turn to exactly these plugins. Unlike
   * `additionalPluginIds`, this excludes the agent's pinned and default tools
   * as well as activator-discoverable manifests.
   */
  exclusivePluginIds?: string[];
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
  /**
   * This start came from a person waiting at a composer, not from a background
   * producer (task callback, cron, bot, API). Interactive starts serialize only
   * on the short topic-start reservation and never on `runningOperation` — the
   * client already owns "one foreground turn at a time" with a queue and a UI,
   * and a refusal here destroys the message before it is ever persisted.
   */
  interactiveStart?: boolean;
  /** Maximum steps for the agent operation */
  maxSteps?: number;
  /**
   * Agents the user @-mentioned in this message (multi-mention). When present
   * (and non-group), the run enables the callAgent tool and persists the mentioned
   * agents into the runtime `initialContext` so the context engine injects the
   * delegation context at step time — making the supervisor delegate to them
   * instead of answering itself. Mirrors the client runtime's mention wiring.
   */
  mentionedAgents?: RuntimeMentionedAgent[];
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
  /**
   * Batch form of `resumeApproval` — every decision the user made in ONE
   * action ("approve all" on a parallel tool batch). The service applies each
   * decision to its tool message and resumes with a single `call_tools_batch`
   * covering all approved tools, so the LLM is continued exactly once with the
   * complete result set.
   *
   * Resolving a parallel batch as N sequential `resumeApproval` calls instead
   * produces N operations, and each one continues the LLM while the tools not
   * yet approved are still empty rows. Mutually exclusive with
   * `resumeApproval`; when both are absent nothing approval-related runs.
   */
  resumeApprovals?: {
    decision: 'approved' | 'rejected' | 'rejected_continue';
    parentMessageId: string;
    rejectionReason?: string;
    toolCallId: string;
  }[];
  /**
   * When present, this execAgent call resumes a previous op that paused on a
   * `humanIntervention: 'always'` tool (e.g. lobe-agent `askUserQuestion`). The
   * service writes the human-provided `content` as the target tool message's
   * result and resumes from `phase: 'tool_result'` — the tool is NOT
   * re-executed. `parentMessageId` must point at the pending `role='tool'`
   * message. Mutually exclusive with `resumeApproval`.
   */
  resumeToolResult?: {
    content: string;
    outcome?: 'skipped' | 'submitted';
    parentMessageId: string;
    pluginState?: Record<string, unknown>;
    rejectionReason?: string;
    toolCallId: string;
  };
  /**
   * Tool identifiers the user @-mentioned in this message. Merged into the
   * agent's plugin set for this run (alongside `additionalPluginIds`) so a
   * mentioned tool that isn't pinned to the agent — e.g. a custom MCP connector
   * picked from the @ list — is enabled and callable. User-scoped lookups
   * downstream (connectors, installed plugins) keep it to the caller's own tools.
   */
  selectedToolIds?: string[];
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
  /**
   * Force the effective `chatConfig.toolMode` for this run. Set by IM bot
   * conversations where the user explicitly switched mode via `/mode` —
   * an explicit per-conversation choice, so it wins over the agent's own
   * chatConfig AND workspace member-mode overrides.
   */
  toolModeOverride?: 'agent' | 'chat';
  /** Running operation that owns the topic for an internally spawned child run. */
  topicStartOwnerOperationId?: string;
  /**
   * Re-enter a topic-start reservation already acquired by an upstream caller,
   * such as TaskResultBridgeService.
   */
  topicStartReservationId?: string;
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
  /**
   * The full config behind {@link boundCwd} (source path + repoType + the
   * active worktree). Callers persist THIS onto the topic, not the flat path:
   * project grouping keys off `config.path` (the source repo), so a run inside
   * a linked worktree must still file under its repo.
   */
  boundCwdConfig?: WorkingDirConfig;
  /**
   * The cwd the topic was ALREADY pinned to, so a caller can tell a first-time
   * binding from a no-op rewrite without re-reading the topic row.
   */
  topicWorkingDirectory?: string;
  workspace: WorkspaceInitResult;
}

/**
 * Turn a raw device-gateway dispatch error code into a human-readable headline.
 * The gateway returns terse machine codes (e.g. `GATEWAY_NOT_CONFIGURED`) which,
 * surfaced verbatim, render as a cryptic error card. We rewrite the headline the
 * caller keeps for non-web surfaces (IM bots) while retaining the raw code in
 * `detail` for diagnostics. Web clients localize via the mapped error type below.
 */
const HETERO_DISPATCH_ERROR_HEADLINES: Record<string, string> = {
  GATEWAY_NOT_CONFIGURED:
    "The run device gateway isn't configured on the server, so this agent can't reach a device to run on. Configure the device gateway, or switch this agent to a connected local device.",
};

const humanizeHeteroDispatchError = (raw?: string): string =>
  (raw && HETERO_DISPATCH_ERROR_HEADLINES[raw]) || raw || 'Device dispatch failed';

/**
 * Map a raw dispatch code to a dedicated `ChatErrorType` so the web client renders
 * its own localized headline (the generic `ServerAgentRuntimeError` copy would
 * otherwise mask the specific message). Unknown codes keep the generic type.
 */
const HETERO_DISPATCH_ERROR_TYPES: Record<string, ErrorType> = {
  GATEWAY_NOT_CONFIGURED: ChatErrorType.DeviceGatewayNotConfigured,
};

const resolveHeteroDispatchErrorType = (raw?: string): ErrorType =>
  (raw && HETERO_DISPATCH_ERROR_TYPES[raw]) || ChatErrorType.ServerAgentRuntimeError;

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
  private _marketService?: MarketService;
  private readonly composioService: ComposioService;

  private readonly workspaceId?: string;
  /**
   * When the caller authenticated with a restricted API key, the unrestricted
   * user JWT minted for gateway WebSocket auth must not be handed back — it
   * passes `oidcAuth` as non-API-key auth and would bypass the scope guard
   * entirely.
   */
  private readonly withholdGatewayToken: boolean;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options?: {
      marketAccessToken?: string;
      runtimeOptions?: AgentRuntimeServiceOptions;
      withholdGatewayToken?: boolean;
      workspaceId?: string;
    },
  ) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = options?.workspaceId;
    this.withholdGatewayToken = options?.withholdGatewayToken ?? false;
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
      agentFactory: createGraphAwareAgentFactory(options?.runtimeOptions?.agentFactory),
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

    // marketService is used for creds, sandbox, skills etc.
    // Read accessToken from DB; if options.marketAccessToken is provided, use it as override.
    if (options?.marketAccessToken) {
      this._marketService = new MarketService({
        accessToken: options.marketAccessToken,
        userInfo: { userId },
      });
    }
    this.composioService = new ComposioService({ db, userId, workspaceId: wsId });
  }

  private async getMarketService(): Promise<MarketService> {
    if (this._marketService) return this._marketService;

    let accessToken: string | undefined;
    try {
      const userModel = new UserModel(this.db, this.userId);
      const settings = await userModel.getUserSettings();
      accessToken = (settings?.market as any)?.accessToken;
    } catch {
      // non-fatal — MarketService will fall back to trustedClientToken
    }

    this._marketService = new MarketService({
      accessToken,
      userInfo: { userId: this.userId },
    });
    return this._marketService;
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
   * Routes through the SAME terminal funnel a normal exit uses —
   * `CompletionLifecycle.completeOperation` finalizes the op row and fires the
   * run's onComplete/onError hooks, so the task lifecycle (onTopicComplete → task
   * failed) and any IM bot completion callback fire exactly as they would for a
   * real failure — then closes the UI stream and clears the (never-started)
   * running operation. The hooks were registered and serialized onto
   * `runningOperation` at dispatch time.
   *
   * Stream-close / hook dispatch / metadata clear are best-effort: a failure
   * there must not mask the original dispatch error the caller surfaces.
   */
  private async finalizeHeteroDispatchError(params: {
    agentId?: string;
    assistantMessageId: string;
    detail: string;
    /**
     * Client error type. Defaults to the generic `ServerAgentRuntimeError`; pass a
     * dedicated `ChatErrorType` (e.g. `DeviceGatewayNotConfigured`) so the web
     * client renders a specific localized headline instead of the generic copy.
     */
    errorType?: ErrorType;
    message: string;
    operationId: string;
    topicId: string;
  }): Promise<void> {
    const {
      agentId,
      assistantMessageId,
      detail,
      errorType = ChatErrorType.ServerAgentRuntimeError,
      message,
      operationId,
      topicId,
    } = params;

    // 1. Error bubble — written first so a stream subscriber reacting to the
    //    end event below re-reads a message that already carries the error.
    await this.messageModel.update(assistantMessageId, {
      content: '',
      error: { body: { detail }, message, type: errorType },
    });

    // 1b. Finalize the run through CompletionLifecycle's single entry — the SAME
    //     owner the CLI exit (heteroFinish) / in-process paths use. It marks the
    //     agent_operations row terminal (the row was inserted at recordStart, but a
    //     dispatch failure goes through THIS path, not heteroFinish, so without
    //     finalizing it the row stays status='running' forever) AND fires the run's
    //     onComplete/onError hooks (task lifecycle → task failed + IM bot callback).
    //     `skipErrorMessageWrite` keeps the bespoke device-specific bubble written
    //     in step 1; verify is done-only, so it no-ops on this error path.
    await new CompletionLifecycle(this.db, this.userId, this.workspaceId).completeOperation(
      {
        agentId,
        assistantMessageId,
        error: { message, type: errorType },
        operationId,
        serializedHooks: hookDispatcher.getSerializedHooks(operationId),
        topicId,
        userId: this.userId,
      },
      'error',
      { skipErrorMessageWrite: true },
    );

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

    // 3. The operation never started — settle the topic so reconnect /
    //    heteroIngest validation and the next turn don't see a stale operation.
    //    Settle, not take: dropping the marker alone would strand `status` on
    //    'running' with nothing left for any later settle to match — see
    //    `ServerOperationStore.clearRunningMark`. 'active' rather than 'unread'
    //    because a dispatch that never started produced nothing to read.
    try {
      await this.topicModel.settleRunningOperation(topicId, operationId, 'active');
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
        userId: this.userId,
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
      const updated = upsertWorkspaceScan(
        workingDirs,
        cached?.path ?? boundCwd,
        scanned,
        Date.now(),
      );
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
  }

  /**
   * Pin a topic to the directory its run actually executes in.
   *
   * A topic created by a device-bound run starts with no cwd of its own: the
   * directory was only ever recorded at agent level
   * (`agencyConfig.workingDirByDevice`) or on the device (`defaultCwd`). Without
   * this write the topic stays unbound — By-Project grouping files it under "No
   * directory", and every later turn re-resolves from the agent config, so
   * changing the agent's directory silently moves an old conversation to a new
   * project (and makes hetero `--resume` unsafe).
   *
   * Shared by BOTH execution paths — hetero device dispatch and the normal
   * agent runtime — so a native agent bound to a device gets the same binding a
   * CLI agent does. Purely additive: a topic that already carries a cwd (the
   * client resolved one and sent it as `initialTopicMetadata`, or an earlier
   * turn bound it) is never rewritten, so the historical pin always wins.
   */
  private async bindTopicWorkingDirectory(params: {
    config?: WorkingDirConfig;
    currentWorkingDirectory?: string;
    topicId: string;
  }): Promise<void> {
    const { config, currentWorkingDirectory, topicId } = params;
    if (currentWorkingDirectory || !config) return;
    const path = getWorkingDirEffectivePath(config);
    if (!path) return;

    try {
      await this.topicModel.updateMetadata(topicId, {
        workingDirectory: path,
        workingDirectoryConfig: config,
      });
    } catch (err) {
      // Metadata bookkeeping must never fail a run that is otherwise fine.
      log('execAgent: bindTopicWorkingDirectory failed (non-fatal): %O', err);
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
   * Resolve an agent by id or slug, with default config merged.
   *
   * Builtin agents (inbox / page / task / self-iteration slugs) may be addressed
   * purely by slug before a row exists — e.g. background self-iteration runs
   * dispatched via `execAgent({ slug })`. Lazily materialize the virtual row from
   * the builtin registry (mirrors the inbox/task `getBuiltinAgent` path) and
   * re-resolve. No-op for ordinary agent ids (getBuiltinAgent returns null).
   */
  private async resolveAgentConfigOrThrow(identifier: string) {
    let agentConfig = await this.agentService.getAgentConfig(identifier);
    if (!agentConfig && (Object.values(BUILTIN_AGENT_SLUGS) as string[]).includes(identifier)) {
      await this.agentModel.getBuiltinAgent(identifier);
      agentConfig = await this.agentService.getAgentConfig(identifier);
    }
    if (!agentConfig) {
      // `agentService.getAgentConfig` already routes through `AgentModel`'s
      // workspace + visibility ownership predicate, so a cross-user private
      // agent resolves to null here. Surface that as NOT_FOUND (not a generic
      // 500) so callers — chat, bot, cron task, sub-agent, REST — return a
      // uniform 404 and we never leak whether the id exists for another user.
      throw new TRPCError({ code: 'NOT_FOUND', message: `Agent not found: ${identifier}` });
    }

    return agentConfig;
  }

  /**
   * Defer an agent run to a future time ("send this in 3 hours").
   *
   * Creates the topic now, `scheduled` and empty, carrying the whole request in
   * `metadata.scheduledRun`; the cron dispatcher replays it through `execAgent`
   * once `runAt` passes. The prompt is deliberately NOT pre-persisted as a user
   * message — storing the request whole keeps the dispatch identical to a user
   * pressing send, and keeps editing / cancelling a pending run a single JSONB
   * write.
   *
   * One-shot only: recurring execution belongs to `tasks.automationMode = 'schedule'`.
   */
  async scheduleAgentRun(params: ScheduleAgentRunParams): Promise<ScheduleAgentRunResult> {
    const { agentId, slug, prompt, runAt, fileIds, groupId, model, provider } = params;

    if (!agentId && !slug) throw new Error('Either agentId or slug must be provided');

    const runAtDate = new Date(runAt);
    if (Number.isNaN(runAtDate.getTime())) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid runAt: ${runAt}` });
    }
    if (runAtDate.getTime() <= Date.now()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'runAt must be in the future' });
    }

    const agentConfig = await this.resolveAgentConfigOrThrow(agentId || slug!);
    const resolvedAgentId = agentConfig.id;

    const titleSource = markdownToTxt(prompt);
    const topic = await this.topicModel.create({
      agentId: resolvedAgentId,
      groupId,
      // A scheduled run is still an ordinary user chat, just deferred — so it
      // keeps the `chat` trigger and stays in the main sidebar (where its
      // `scheduled` status renders a clock), unlike system-owned cron topics.
      title: titleSource.slice(0, 50) + (titleSource.length > 50 ? '...' : ''),
      trigger: 'chat',
    });

    // Persist the user turn now rather than stashing the prompt in metadata: the
    // pending run then reads as the user's own words in the topic, and the message
    // stays the single source of truth for the prompt (the dispatcher reads it
    // back, so editing a pending run is just editing the message).
    const userMessage = await this.messageModel.create({
      agentId: resolvedAgentId,
      content: prompt,
      files: fileIds,
      groupId: groupId ?? undefined,
      metadata: { trigger: RequestTrigger.Scheduled },
      role: 'user',
      topicId: topic.id,
    });

    const now = new Date().toISOString();
    await this.topicModel.armScheduledRun(topic.id, {
      createdAt: now,
      kind: 'delayed_start',
      model,
      provider,
      // Normalize to UTC ISO: the dispatcher's due query compares this as text.
      runAt: runAtDate.toISOString(),
      updatedAt: now,
      userMessageId: userMessage.id,
    });

    log(
      'scheduleAgentRun: topic %s scheduled for %s (agent %s, message %s)',
      topic.id,
      runAtDate.toISOString(),
      resolvedAgentId,
      userMessage.id,
    );

    return { agentId: resolvedAgentId, runAt: runAtDate.toISOString(), topicId: topic.id };
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
  async execAgent(inputParams: InternalExecAgentParams): Promise<ExecAgentResult> {
    // Creating the thread here (rather than inside the turn) means a run that
    // asked for one is already a thread run by the time the reservation check
    // below reads `appContext.threadId` — same isolation as a follow-up inside
    // an existing thread.
    const { createdThreadId, params } = await this.resolveNewThread(inputParams);
    // The client needs the id back to pivot its optimistic `_new` thread bucket
    // and refresh the sidebar; every return path below must carry it.
    const withCreatedThread = (result: ExecAgentResult): ExecAgentResult =>
      createdThreadId ? { ...result, createdThreadId } : result;

    const topicId = params.appContext?.topicId;
    const interventionReservationId = params.approvalResolutionRequestId
      ? deriveAgentInterventionContinuationOperationId({
          resolutionRequestId: params.approvalResolutionRequestId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
      : undefined;
    if (
      interventionReservationId &&
      params.topicStartReservationId &&
      params.topicStartReservationId !== interventionReservationId
    ) {
      throw new Error('Intervention continuation reservation identity conflict');
    }
    const reservationId =
      interventionReservationId ?? params.topicStartReservationId ?? `agent-start-${nanoid()}`;
    const isInterventionThreadStart = Boolean(
      topicId &&
      params.appContext?.threadId &&
      interventionReservationId &&
      params.approvalResolutionRequestId,
    );
    // Thread runs are isolated under an explicit parent message and do not
    // advance the topic's main spine. They may start while their parent
    // operation owns `runningOperation` (for example callAgent/callSubAgent),
    // so making them wait for the topic-start claim deadlocks the child start.
    if (!topicId || (params.appContext?.threadId && !isInterventionThreadStart)) {
      return withCreatedThread(await this.execAgentWithApprovalRollback(params));
    }

    // A replacement is allowed to take over the topic marker, but the device
    // process that owned the old marker may still hold a native Codex/CC writer.
    // Settle that physical run before reserving and dispatching the replacement;
    // otherwise two `lh hetero exec` wrappers can resume the same thread.
    if (params.replacesOperationId && !isInterventionThreadStart) {
      const interruption = await this.interruptTask({
        operationId: params.replacesOperationId,
        topicId,
      });
      if (interruption.deviceCancellationConfirmed === false) {
        throw new Error('Replaced heterogeneous agent process did not confirm termination');
      }
    }
    const reserved = await acquireTopicStartReservation({
      allowSameReservationReentry: !params.approvalResolutionRequestId,
      replacesOperationId: isInterventionThreadStart ? undefined : params.replacesOperationId,
      allowRunningOperationId: params.topicStartOwnerOperationId,
      // A thread continuation shares the topic row but never owns/replaces its
      // main runningOperation anchor. It uses only the short initializer fence.
      ignoreRunningOperation: isInterventionThreadStart || params.interactiveStart,
      reservationId,
      topicId,
      topicModel: this.topicModel,
    });

    if (!reserved) {
      throw new Error(`Topic not found: ${topicId}`);
    }

    try {
      return withCreatedThread(await this.execAgentWithApprovalRollback(params));
    } finally {
      await this.topicModel.releaseTaskCallbackReservation(topicId, reservationId);
    }
  }

  /**
   * A human decision is claimed before the rest of operation preparation reads
   * message history. Keep its rollback guard outside the large preparation
   * routine so every throw and every early return before createOperation starts
   * restores the exact pending rows, not only queue-start failures.
   */
  private async execAgentWithApprovalRollback(
    params: InternalExecAgentParams,
  ): Promise<ExecAgentResult> {
    const approvalClaim = {
      continuationPrepared: false,
      continuationStarted: false,
      rollbackSnapshot: [] as HumanApprovalResolution[],
    };

    try {
      return await this.execAgentWithReservation(params, approvalClaim);
    } finally {
      if (
        !approvalClaim.continuationPrepared &&
        !approvalClaim.continuationStarted &&
        approvalClaim.rollbackSnapshot.length > 0
      ) {
        await this.messageModel.restoreHumanApproval(approvalClaim.rollbackSnapshot);
        log(
          'execAgent: restored %d approval rows before continuation startup',
          approvalClaim.rollbackSnapshot.length,
        );
      }
    }
  }

  /**
   * Materialise an `appContext.newThread` intent into a real thread row.
   *
   * The composer stages a subtopic client-side and the non-gateway send path
   * creates it inside `sendMessageInServer` (`newThread`). The gateway path
   * never makes that call, so the intent arrives here instead — without this
   * the turn would persist onto the topic's main spine, no thread row would
   * exist, and the subtopic would silently collapse back into the main
   * conversation.
   *
   * Returns the params to run with: `appContext.threadId` rebound to the new
   * thread so every downstream read (message writes, history queries, operation
   * context) lands inside it. A no-op for every caller that doesn't ask for one.
   */
  private async resolveNewThread(params: InternalExecAgentParams): Promise<{
    createdThreadId?: string;
    params: InternalExecAgentParams;
  }> {
    const { appContext } = params;
    const newThread = appContext?.newThread;

    // `threadId` wins: that is a follow-up inside a thread that already exists,
    // and creating a second row would orphan the earlier turns.
    if (!newThread || appContext?.threadId) return { params };

    // A subtopic branches off a persisted message, so its topic always exists by
    // the time the send reaches here. Refusing is better than silently creating
    // a thread on a topic this run is about to mint under a different id.
    if (!appContext?.topicId) {
      throw new Error('appContext.newThread requires an existing appContext.topicId');
    }

    const thread = await this.threadModel.create({
      parentThreadId: newThread.parentThreadId,
      sourceMessageId: newThread.sourceMessageId,
      title: newThread.title,
      topicId: appContext.topicId,
      type: newThread.type,
    });

    // `ThreadModel.create` swallows insert conflicts and returns undefined.
    // Falling through would persist the turn to the main spine — exactly the
    // failure this path exists to prevent — so fail loudly instead.
    if (!thread) {
      throw new Error(`Failed to create thread on topic ${appContext.topicId}`);
    }

    log('execAgent: created thread %s on topic %s', thread.id, appContext.topicId);

    return {
      createdThreadId: thread.id,
      params: {
        ...params,
        appContext: { ...appContext, threadId: thread.id },
        createdThreadId: thread.id,
      },
    };
  }

  private async execAgentWithReservation(
    params: InternalExecAgentParams,
    approvalClaim: {
      continuationPrepared: boolean;
      continuationStarted: boolean;
      rollbackSnapshot: HumanApprovalResolution[];
    },
  ): Promise<ExecAgentResult> {
    const {
      additionalPluginIds,
      exclusivePluginIds,
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      botContext,
      createdThreadId,
      clientIp,
      userAgent,
      deviceId: requestedDeviceId,
      localDeviceId,
      botPlatformContext,
      discordContext,
      existingMessageIds = [],
      fileIds: attachedFileIds,
      files,
      functionTools,
      hooks,
      instructions,
      chatConfigOverride,
      toolModeOverride,
      model: modelOverride,
      provider: providerOverride,
      stream,
      title,
      trigger,
      cronJobId,
      taskId,
      evalContext,
      evalRuntime,
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
      resumeApprovals,
      resumeToolResult,
      approvalResolutionRequestId: providedApprovalResolutionRequestId,
      approvalSourceOperationId: providedApprovalSourceOperationId,
      selectedToolIds,
      mentionedAgents,
      suppressUserMessage,
      ephemeralUserMessage,
    } = params;

    // Honour client-minted row ids on a FRESH send only. Resume / regeneration
    // replays reach this method too (resumeApproval, resumeToolResult,
    // parentMessageId), and a replayed id there would collide with the row the
    // original send already created — so those paths drop the ids defensively
    // rather than trusting every caller to omit them.
    const interventionResumeCount = [resumeApproval, resumeApprovals, resumeToolResult].filter(
      Boolean,
    ).length;
    if (interventionResumeCount > 1) {
      throw new Error(
        'Only one of resumeApproval, resumeApprovals, or resumeToolResult may be provided',
      );
    }

    const isResumeLike =
      !!resume ||
      !!resumeApproval ||
      !!resumeApprovals?.length ||
      !!resumeToolResult ||
      !!parentMessageId;
    const clientIds = isResumeLike ? undefined : params.clientIds;

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
    const agentConfig = await this.resolveAgentConfigOrThrow(identifier);

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
    if (this.workspaceId) {
      try {
        const workspaceUserSettings = new WorkspaceUserSettingsModel(
          this.db,
          this.userId,
          this.workspaceId,
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

    let canManageAgent = agentConfig.userId === this.userId;
    const agentWorkspaceId = agentConfig.workspaceId ?? this.workspaceId;
    const isPublicWorkspaceAgent = !!agentWorkspaceId && agentConfig.visibility !== 'private';
    if (isPublicWorkspaceAgent && !canManageAgent) {
      try {
        // Author-or-admin, NOT the configuration flag: this value decides whether
        // the run ignores the member's own model / device / mode overrides, and a
        // collaborative builtin must keep honoring them — the client runtime
        // (`agentConfigResolver`) resolves the same distinction from authorship.
        canManageAgent = await isResourceAuthorOrAdmin({
          db: this.db,
          meta: {
            userId: agentConfig.userId,
            visibility: agentConfig.visibility ?? 'public',
            workspaceId: agentWorkspaceId,
          },
          resourceType: 'agent',
          userId: this.userId,
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
        const userInfo = await UserModel.getInfoForAIGeneration(this.db, this.userId);
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

    let resumeParentMessage: Awaited<ReturnType<MessageModel['findById']>>;

    // `resumeApproval` implies the same "load parent message + skip user
    // message creation" semantics as `resume`. Callers that go through the
    // tRPC router get `resume: true` via the router, but the service-level
    // API allows resumeApproval alone — fold both into a single effective
    // flag so downstream resume branches don't need to know about approval.
    // Normalize the single and batch approval forms into one list so every
    // branch below (validation, DB writes, resume context) has a single shape
    // to reason about. `resumeApproval` stays the wire format for one decision.
    const approvalDecisions = resumeApprovals?.length
      ? resumeApprovals
      : resumeApproval
        ? [resumeApproval]
        : [];

    const effectiveResume = resume || approvalDecisions.length > 0 || !!resumeToolResult;

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
    /**
     * Approved decisions paired with their plugin row, in the order the caller
     * listed them. Drives the batch resume context at 16b; the tool message id
     * doubles as the row `call_tools_batch` fills in place.
     */
    const approvedToolEntries: {
      createdAt: Date;
      plugin: MessagePluginItem;
      toolMessageId: string;
    }[] = [];
    /** Assistant that emitted this batch — the pending tool rows' shared parent. */
    let approvalOwnerAssistantId: string | undefined;
    let approvalResolutionRequestId: string | undefined;
    let approvalSourceOperationId: string | undefined;
    let approvalSourceToolMessageIds: string[] = [];

    // Load and validate EVERY decision before applying any of them. The apply
    // step writes per entry, so validating inline would leave a rejected batch
    // half-persisted — some tools already marked approved with no run to
    // execute them.
    const validatedDecisions: {
      alreadyClaimed: boolean;
      entry: (typeof approvalDecisions)[number];
      plugin: MessagePluginItem;
      targetMessage: NonNullable<typeof resumeParentMessage>;
    }[] = [];

    for (const decisionEntry of approvalDecisions) {
      // The single-decision form validated `parentMessageId` (the op-level
      // resume anchor) as the target tool message. In the batch form each
      // decision names its own tool message, so load and validate per entry —
      // the op-level anchor is only one of them.
      const targetMessage =
        decisionEntry.parentMessageId === parentMessageId
          ? resumeParentMessage
          : await this.messageModel.findById(decisionEntry.parentMessageId);

      if (!targetMessage) {
        throw new Error(`resumeApproval: tool message not found: ${decisionEntry.parentMessageId}`);
      }
      if (targetMessage.role !== 'tool') {
        throw new Error(
          `resumeApproval.parentMessageId must point at a role='tool' message, got role='${targetMessage.role}'`,
        );
      }
      if (targetMessage.topicId !== appContext?.topicId) {
        throw new Error('appContext.topicId does not match approval target message');
      }

      const plugin = await this.messageModel.findMessagePlugin(decisionEntry.parentMessageId);
      if (!plugin) {
        throw new Error(
          `resumeApproval: no plugin row for tool message ${decisionEntry.parentMessageId}`,
        );
      }
      if (plugin.toolCallId && plugin.toolCallId !== decisionEntry.toolCallId) {
        throw new Error(
          `resumeApproval.toolCallId mismatch for message ${decisionEntry.parentMessageId}: ` +
            `stored=${plugin.toolCallId}, requested=${decisionEntry.toolCallId}`,
        );
      }
      const expectedStatus = decisionEntry.decision === 'approved' ? 'approved' : 'rejected';
      const alreadyClaimed =
        plugin.intervention?.status === expectedStatus &&
        Boolean(providedApprovalResolutionRequestId) &&
        plugin.intervention.resolutionRequestId === providedApprovalResolutionRequestId;
      if (plugin.intervention?.status !== 'pending' && !alreadyClaimed) {
        throw new HumanApprovalAlreadyResolvedError(decisionEntry.parentMessageId);
      }

      validatedDecisions.push({ alreadyClaimed, entry: decisionEntry, plugin, targetMessage });
    }

    // A batch resume executes every approved tool as ONE `call_tools_batch`
    // under ONE assistant anchor and continues the LLM once. That is only
    // meaningful when the calls actually came from the same assistant turn.
    // The client scopes its selection, but a stale or hand-built request could
    // mix an abandoned approval from an earlier turn into this one — which
    // would run an unrelated tool and fold its result into a turn it does not
    // belong to. Reject rather than silently anchoring on whichever entry came
    // first.
    const approvalOwnerIds = new Set(
      validatedDecisions.map(({ targetMessage }) => targetMessage.parentId ?? '(none)'),
    );
    if (approvalOwnerIds.size > 1) {
      throw new Error(
        `resumeApprovals must resolve one assistant turn, got ${approvalOwnerIds.size} owners: ` +
          [...approvalOwnerIds].join(', '),
      );
    }

    if (validatedDecisions.length > 0) {
      const sourceOperationIds = new Set(
        validatedDecisions
          .map(({ plugin }) => plugin.intervention?.operationId)
          .filter((id): id is string => typeof id === 'string' && !!id),
      );
      if (
        sourceOperationIds.size > 1 ||
        (providedApprovalSourceOperationId &&
          (sourceOperationIds.size !== 1 ||
            !sourceOperationIds.has(providedApprovalSourceOperationId)))
      ) {
        throw new Error('Approval targets do not match the authoritative parked operation');
      }
      approvalSourceOperationId = providedApprovalSourceOperationId ?? [...sourceOperationIds][0];
      approvalSourceToolMessageIds = validatedDecisions.map(({ entry }) => entry.parentMessageId);
      approvalResolutionRequestId = providedApprovalResolutionRequestId ?? `legacy_${nanoid()}`;
      const unclaimedDecisions = validatedDecisions.filter(({ alreadyClaimed }) => !alreadyClaimed);
      const approvalRollbackSnapshot = unclaimedDecisions.map(({ plugin, targetMessage }) => ({
        claimedResolutionRequestId: approvalResolutionRequestId,
        ...(typeof targetMessage.content === 'string' ? { content: targetMessage.content } : {}),
        id: targetMessage.id,
        intervention: (plugin.intervention ?? { status: 'pending' }) as Record<string, unknown>,
        pluginState: (plugin.state ?? null) as Record<string, unknown> | null,
        replacePluginState: true,
      }));

      // Shared exactly-once boundary for Web, Mobile, Stop, and signed system
      // actions. All rows are locked and checked before the first write.
      if (unclaimedDecisions.length > 0) {
        const claimState = await this.messageModel.resolveHumanApproval(
          unclaimedDecisions.map(({ entry }) => {
            if (entry.decision === 'approved') {
              return {
                id: entry.parentMessageId,
                intervention: {
                  resolutionRequestId: approvalResolutionRequestId,
                  status: 'approved',
                },
              };
            }
            return {
              content: entry.rejectionReason
                ? `User reject this tool calling with reason: ${entry.rejectionReason}`
                : 'User reject this tool calling without reason',
              id: entry.parentMessageId,
              intervention: {
                rejectedReason: entry.rejectionReason,
                resolutionRequestId: approvalResolutionRequestId,
                status: 'rejected',
              },
            };
          }),
        );
        if (claimState === 'applied') {
          approvalClaim.rollbackSnapshot = approvalRollbackSnapshot;
        }
      }
      if (providedApprovalResolutionRequestId) {
        // A generic durable claim is recovered by this same request id. Never
        // locally reopen its source rows: a concurrent reentrant same-id call
        // may already have created the deterministic assistant/op/state.
        approvalClaim.continuationPrepared = true;
      }
    }

    for (const { entry: decisionEntry, plugin, targetMessage } of validatedDecisions) {
      const { decision } = decisionEntry;
      if (decision === 'approved') {
        approvedToolEntries.push({
          createdAt: targetMessage.createdAt,
          plugin,
          toolMessageId: decisionEntry.parentMessageId,
        });
        approvalOwnerAssistantId ??= targetMessage.parentId ?? undefined;
      }

      // Kept for the single-decision resume context at 16b, which reads the
      // plugin of the op-level anchor message.
      if (decisionEntry.parentMessageId === parentMessageId) resumeApprovalPlugin = plugin;

      log(
        'execAgent: resumeApproval decision=%s applied to tool message %s (toolCallId=%s)',
        decision,
        decisionEntry.parentMessageId,
        decisionEntry.toolCallId,
      );
    }

    // The approval pause creates one row per pending tool sequentially, in the
    // order the model emitted the calls — so row creation order IS declaration
    // order, and sorting by it makes the resume independent of how the client
    // happened to order its request array.
    approvedToolEntries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    /**
     * Spine anchor for a batch approval: the ASSISTANT that emitted the batch —
     * i.e. the previous LLM call. A step is one LLM call, and tool rows are
     * inline data of the call that produced them, never spine nodes. So the
     * continuation assistant created below chains directly onto that assistant
     * (`user → asst → asst …`, tools hanging off their caller) rather than onto
     * one of the batch's tool rows, which would make the spine depend on which
     * tool row you happened to pick and on the order they were written in.
     */
    const batchApprovalAnchorId = resumeApprovals?.length ? approvalOwnerAssistantId : undefined;

    // 2.7. Human-answer resume: a `humanIntervention: 'always'` tool (e.g.
    // lobe-agent `askUserQuestion`) paused this run. Write the human-provided
    // answer as the target tool message's result and mark the intervention
    // approved so the history fetched below reflects the answer before the
    // first step runs. Unlike `resumeApproval` (`approved`), we resume from
    // `phase: 'tool_result'` (see 16c) rather than re-executing the tool — the
    // answer IS the result. Same validation shape as resumeApproval:
    // parent must be a pending role='tool' message tied to the tool call.
    // `resumeApproval` and `resumeToolResult` are mutually exclusive.
    if (resumeToolResult) {
      if (!resumeParentMessage) {
        throw new Error('resumeToolResult requires parentMessageId to point at a tool message');
      }
      if (resumeParentMessage.role !== 'tool') {
        throw new Error(
          `resumeToolResult.parentMessageId must point at a role='tool' message, got role='${resumeParentMessage.role}'`,
        );
      }

      const resumeToolResultPlugin = await this.messageModel.findMessagePlugin(
        resumeToolResult.parentMessageId,
      );
      if (!resumeToolResultPlugin) {
        throw new Error(
          `resumeToolResult: no plugin row for tool message ${resumeToolResult.parentMessageId}`,
        );
      }
      if (
        resumeToolResultPlugin.toolCallId &&
        resumeToolResultPlugin.toolCallId !== resumeToolResult.toolCallId
      ) {
        throw new Error(
          `resumeToolResult.toolCallId mismatch for message ${resumeToolResult.parentMessageId}: ` +
            `stored=${resumeToolResultPlugin.toolCallId}, requested=${resumeToolResult.toolCallId}`,
        );
      }
      const skipped = resumeToolResult.outcome === 'skipped';
      const expectedToolResultStatus = skipped ? 'rejected' : 'approved';
      const alreadyClaimed =
        resumeToolResultPlugin.intervention?.status === expectedToolResultStatus &&
        Boolean(providedApprovalResolutionRequestId) &&
        resumeToolResultPlugin.intervention.resolutionRequestId ===
          providedApprovalResolutionRequestId &&
        (!skipped || resumeToolResultPlugin.intervention.skipped === true);
      if (resumeToolResultPlugin.intervention?.status !== 'pending' && !alreadyClaimed) {
        throw new HumanApprovalAlreadyResolvedError(resumeToolResult.parentMessageId);
      }
      const toolResultSourceOperationId = resumeToolResultPlugin.intervention?.operationId;
      if (
        providedApprovalSourceOperationId &&
        toolResultSourceOperationId !== providedApprovalSourceOperationId
      ) {
        throw new Error('Approval target does not match the authoritative parked operation');
      }
      approvalSourceOperationId =
        providedApprovalSourceOperationId ?? toolResultSourceOperationId ?? undefined;
      approvalSourceToolMessageIds = [resumeToolResult.parentMessageId];

      approvalResolutionRequestId = providedApprovalResolutionRequestId ?? `legacy_${nanoid()}`;
      const approvalRollbackSnapshot = alreadyClaimed
        ? []
        : [
            {
              claimedResolutionRequestId: approvalResolutionRequestId,
              ...(typeof resumeParentMessage.content === 'string'
                ? { content: resumeParentMessage.content }
                : {}),
              id: resumeToolResult.parentMessageId,
              intervention: (resumeToolResultPlugin.intervention ?? {
                status: 'pending',
              }) as Record<string, unknown>,
              pluginState: (resumeToolResultPlugin.state ?? null) as Record<string, unknown> | null,
              replacePluginState: true,
            },
          ];
      if (!alreadyClaimed) {
        const claimState = await this.messageModel.resolveHumanApproval([
          {
            content: resumeToolResult.content,
            id: resumeToolResult.parentMessageId,
            intervention: skipped
              ? {
                  rejectedReason: resumeToolResult.rejectionReason,
                  resolutionRequestId: approvalResolutionRequestId,
                  skipped: true,
                  status: 'rejected',
                }
              : { resolutionRequestId: approvalResolutionRequestId, status: 'approved' },
            pluginState: resumeToolResult.pluginState,
          },
        ]);
        if (claimState === 'applied') {
          approvalClaim.rollbackSnapshot = approvalRollbackSnapshot;
        }
      }
      if (providedApprovalResolutionRequestId) {
        approvalClaim.continuationPrepared = true;
      }

      log(
        'execAgent: resumeToolResult applied to tool message %s (toolCallId=%s)',
        resumeToolResult.parentMessageId,
        resumeToolResult.toolCallId,
      );
    }

    // 3. Handle topic creation: if no topicId provided, create a new topic; otherwise reuse existing
    let topicId = appContext?.topicId;
    const continuationIdentity = providedApprovalResolutionRequestId
      ? {
          resolutionRequestId: providedApprovalResolutionRequestId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        }
      : undefined;
    const continuationOperationId = continuationIdentity
      ? deriveAgentInterventionContinuationOperationId(continuationIdentity)
      : undefined;
    const continuationAssistantId = continuationIdentity
      ? deriveAgentInterventionContinuationMessageId(continuationIdentity)
      : undefined;

    // This check runs *inside* the topic-start reservation. Two same-request
    // callers may both probe before the first claim is visible, but only the
    // winner reaches createOperation; the follower observes and reuses its
    // deterministic state here instead of overwriting it. Idle state is
    // explicitly requeued from its saved initialContext; operation+step locks
    // de-duplicate concurrent queue delivery.
    if (
      continuationOperationId &&
      continuationAssistantId &&
      providedApprovalResolutionRequestId &&
      approvalSourceOperationId &&
      topicId
    ) {
      const existingState =
        await this.agentRuntimeService.loadInterventionContinuationState(continuationOperationId);
      const preparation = existingState?.metadata?.agentInterventionPreparation as
        { resolutionRequestId?: unknown; state?: unknown } | undefined;
      if (
        existingState &&
        preparation?.state === 'ready' &&
        preparation.resolutionRequestId === providedApprovalResolutionRequestId
      ) {
        const existingOperation = await this.agentOperationModel.findById(continuationOperationId);
        const expectedProvenance = {
          resolutionRequestId: providedApprovalResolutionRequestId,
          sourceOperationId: approvalSourceOperationId,
          sourceToolMessageIds: [...approvalSourceToolMessageIds].sort(),
        };
        const existingAssistant = await this.messageModel.findById(continuationAssistantId);
        const matches =
          existingOperation?.agentId === resolvedAgentId &&
          existingOperation.topicId === topicId &&
          existingOperation.appContext?.sourceMessageId === parentMessageId &&
          matchesAgentInterventionContinuationProvenance(
            existingOperation.metadata?.agentInterventionContinuation,
            expectedProvenance,
          ) &&
          existingState.operationId === continuationOperationId &&
          existingState.metadata?.userId === this.userId &&
          (existingState.metadata?.workspaceId ?? null) === (this.workspaceId ?? null) &&
          existingState.metadata?.agentId === resolvedAgentId &&
          existingState.metadata?.topicId === topicId &&
          existingState.metadata?.sourceMessageId === parentMessageId &&
          matchesAgentInterventionContinuationProvenance(
            existingState.metadata?.agentInterventionContinuation,
            expectedProvenance,
          ) &&
          existingAssistant?.role === 'assistant' &&
          existingAssistant.topicId === topicId;
        if (!matches) {
          throw new Error(
            `Intervention continuation operation identity conflict: ${continuationOperationId}`,
          );
        }

        const start =
          await this.agentRuntimeService.ensureInterventionContinuationStarted(
            continuationOperationId,
          );
        if (start === 'missing') {
          throw new Error(
            `Intervention continuation state disappeared: ${continuationOperationId}`,
          );
        }
        approvalClaim.continuationStarted = true;

        let gatewayToken: string | undefined;
        if (!this.withholdGatewayToken) {
          try {
            gatewayToken = await signUserJWT(this.userId);
          } catch {
            log('execAgent: failed to sign gateway JWT for reused intervention continuation');
          }
        }
        const now = new Date().toISOString();
        return {
          agentId: resolvedAgentId,
          assistantMessageId: continuationAssistantId,
          autoStarted: true,
          createdAt: now,
          heteroType: null,
          message: 'Agent intervention continuation already created',
          operationId: continuationOperationId,
          status: 'created',
          success: true,
          timestamp: now,
          token: gatewayToken,
          topicId,
          userMessageId: parentMessageId ?? '',
        };
      }
    }
    const isFixedExecutionTargetSelection =
      !!this.workspaceId && agentConfig.agencyConfig?.executionTargetSelectionPolicy === 'fixed';
    const isFixedDeviceTarget =
      isFixedExecutionTargetSelection && agentConfig.agencyConfig?.executionTarget === 'device';
    const effectiveRequestedDeviceId = isFixedExecutionTargetSelection
      ? undefined
      : requestedDeviceId;
    const topicBoundDeviceId = isFixedDeviceTarget
      ? agentConfig.agencyConfig?.boundDeviceId
      : isFixedExecutionTargetSelection
        ? undefined
        : requestedDeviceId;

    // Effective model/provider for this run. Defaults to the agent config, but a
    // topic pins its own model in the top-level `topics.model`/`provider` columns
    // (config source of truth) — snapshotted on creation, and honored below when
    // reusing a topic whose model was switched while active. Keeps the Gateway/
    // cloud path in sync with the client local path (see streamingExecutor +
    // getTopicModelById).
    let model = agentConfig.model!;
    let provider = agentConfig.provider!;
    const heterogeneousProvider = agentConfig.agencyConfig?.heterogeneousProvider;
    const heterogeneousTopicModelSnapshot = heterogeneousProvider
      ? resolveHeterogeneousProviderTopicModel(heterogeneousProvider)
      : undefined;
    let pinnedHeterogeneousTopicModel: HeterogeneousTopicModel | undefined;

    if (!topicId) {
      if (resume) {
        throw new Error('Resume mode requires the parent message to belong to a topic');
      }

      // Prepare metadata with cronJobId, taskId, botContext, bound device, and any
      // client-supplied initial metadata (e.g. repos selected before first message).
      const initialTopicMeta = appContext?.initialTopicMetadata;
      // Builder conversations are owned by a builtin builder agent and get no
      // `groupId` / `sessionId` (those columns mark the target's own chat), so
      // without this the row keeps no trace of what it was configuring. The
      // association exists only at run time: a topic written without it can
      // never be attributed afterwards, which is why it is stamped even though
      // nothing filters on it yet.
      const { editingAgentId, editingGroupId } = appContext ?? {};
      const metadata =
        cronJobId ||
        operationTaskId ||
        botContext ||
        topicBoundDeviceId ||
        initialTopicMeta ||
        editingGroupId ||
        editingAgentId
          ? {
              bot: botContext,
              boundDeviceId: topicBoundDeviceId,
              cronJobId: cronJobId || undefined,
              ...(editingAgentId && { editingAgentId }),
              ...(editingGroupId && { editingGroupId }),
              taskId: operationTaskId,
              ...(initialTopicMeta?.repos && { repos: initialTopicMeta.repos }),
              ...(initialTopicMeta?.workingDirectory && {
                workingDirectory: initialTopicMeta.workingDirectory,
              }),
              ...(initialTopicMeta?.workingDirectoryConfig && {
                workingDirectoryConfig: initialTopicMeta.workingDirectoryConfig,
              }),
            }
          : undefined;

      const fallbackTitleSource = markdownToTxt(prompt);
      // Heterogeneous topics use the same snapshot rule as the client: persist
      // the selected CLI model (including `default`) or user-provider API binding.
      // Runtimes without a model selector, legacy rows, and Agent-scoped
      // server-default API configs still pin only the runtime type.
      const heteroSnapshotType =
        heterogeneousProvider?.type ?? (isHeterogeneousAgentModelId(model) ? model : undefined);
      // Second argument: the id the client already rendered this topic under
      // (sidebar row, message bucket). Absent → the model mints one as before.
      const newTopic = await this.topicModel.create(
        {
          agentId: resolvedAgentId,
          // Persist the group association when running inside a group conversation.
          // Without it the topic is created group-less and only shows under the
          // member agent's topic list — never in the group sidebar (which queries
          // `topics.groupId`), so the conversation silently "disappears" from the
          // group. execGroupAgent normally pre-creates the topic, but any path
          // that reaches execAgent without a topicId (e.g. the async/queue run)
          // must carry the groupId through too (group topic sidebar + ownership fix).
          groupId: appContext?.groupId,
          metadata,
          // Snapshot the effective model as the topic's pinned model (config).
          model: heterogeneousTopicModelSnapshot?.model ?? (heteroSnapshotType ? undefined : model),
          provider: heterogeneousTopicModelSnapshot?.provider ?? heteroSnapshotType ?? provider,
          title:
            title !== undefined
              ? title
              : fallbackTitleSource.slice(0, 50) + (fallbackTitleSource.length > 50 ? '...' : ''),
          trigger,
        },
        clientIds?.topicId,
      );
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

      // Honor a topic-pinned model (snapshotted on creation, updated when the
      // user switched model while the topic was active) over the agent default.
      // Explicit per-run values (such as callSubAgent) override their own field.
      // The pinned model lives in the top-level `topics.model`/`provider` columns
      // (config source of truth), NOT in metadata.
      const existingTopic = await this.topicModel.findById(topicId);
      const pinnedModel = existingTopic?.model;
      if (pinnedModel) {
        model = modelOverride || pinnedModel;
        provider = providerOverride || existingTopic?.provider || provider;
        pinnedHeterogeneousTopicModel = { model, provider };
        log(
          'execAgent: using topic-pinned model=%s provider=%s for topic %s',
          model,
          provider,
          topicId,
        );
      }
    }

    await throwIfExecutionAborted('topic setup');

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

    // 3.5. Hetero-agent early exit — local CLI and remote platform agents bypass the
    // server-side LLM pipeline.  After topic + message creation we hand off to
    // the device gateway (desktop) or cloud sandbox, which will push events
    // back via `heteroIngest` / `heteroFinish` (amp / claude-code / codebuddy /
    // codex / cursor / kimi-code / opencode / pi / qoder) or
    // `agentNotify.notify` (openclaw / hermes).
    //
    // Detection: prefer agencyConfig.heterogeneousProvider.type (set by the UI),
    // fall back to the legacy `model` field for backwards compatibility (shared
    // with the inbox write guard via `isHeterogeneousAgentModelId`).
    const heteroProviderType = agentConfig.agencyConfig?.heterogeneousProvider?.type;
    const isHeteroAgent = !!heteroProviderType || isHeterogeneousAgentModelId(model);
    const heteroType = (heteroProviderType ?? model) as HeterogeneousAgentType;

    // ── Shared turn setup (runs for BOTH hetero and normal agents) ──────────
    // Everything up to and including persisting the turn is identical for both
    // execution modes, so it lives here, before the fork, and both branches
    // consume the same records. Keeping it in one place is what guarantees the
    // hetero path can't drift from the standard path again (the bot-image bug
    // came from the hetero branch re-implementing — and skipping — this step).
    const requestTriggerMetadata = {
      ...(trigger && Object.values(RequestTrigger).includes(trigger as RequestTrigger)
        ? { trigger: trigger as RequestTrigger }
        : undefined),
      ...(appContext?.conversationAgentId && appContext.scope === 'sub_agent'
        ? { agentDispatch: { kind: 'callAgent' as const, visibility: 'internal' as const } }
        : undefined),
    };

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
    // Anchor the new user turn on the conversation tail. Never leave it
    // undefined for a topic that already has messages: `parentId: undefined`
    // persists a second ROOT, and the renderer walks the parentId forest
    // depth-first — an earlier root's still-growing subtree is emitted before a
    // later root, so the newest reply lands ABOVE older messages.
    //
    // `getLatestSpineMessageId` skips tool rows and toolless signal turns, so it
    // can come back empty on a topic built entirely from signal callbacks; fall
    // back to the latest non-tool row rather than orphaning the turn.
    const resolveUserMessageParentId = async () => {
      if (runFromHistory) return undefined;
      if (parentMessageId) return parentMessageId;
      // A thread created for THIS turn is empty, so there is no spine head to
      // anchor on. Its branch point is the source message — the same anchor the
      // non-gateway path keeps for a brand-new thread. Without it the first turn
      // persists as a second root and the renderer's parentId walk emits it out
      // of order.
      if (createdThreadId) return appContext?.newThread?.sourceMessageId;

      const threadId = appContext?.threadId ?? null;
      const spineId = await this.messageModel.getLatestSpineMessageId({ threadId, topicId });
      if (spineId) return spineId;

      const fallbackId = await this.messageModel.getLatestNonToolMessageId({ threadId, topicId });
      if (fallbackId) {
        log(
          'execAgent: no spine head for topic %s, anchoring user turn on latest non-tool message %s',
          topicId,
          fallbackId,
        );
      }
      return fallbackId;
    };
    const userMessageParentId = await resolveUserMessageParentId();
    const userMessageRecord = runFromHistory
      ? undefined
      : await this.messageModel.create(
          {
            agentId: conversationAgentId,
            content: prompt,
            files: runAttachments.fileIds,
            // Group reads filter on messages.groupId (MessageModel.query group
            // branch), so a group turn must stamp groupId or the message never
            // shows when the topic is reopened (group topic sidebar + ownership fix).
            groupId: appContext?.groupId ?? undefined,
            metadata: requestTriggerMetadata,
            parentId: userMessageParentId,
            role: 'user',
            threadId: appContext?.threadId ?? undefined,
            topicId,
          },
          // The id the client's optimistic user row already renders under.
          clientIds?.userMessageId,
        );
    if (userMessageRecord) {
      selfMessageIds.add(userMessageRecord.id);
      log('execAgent: created user message %s', userMessageRecord.id);
    }

    // Snapshot the author's group orchestration role onto the assistant message
    // so the role survives the server round-trip (gateway step_start snapshot /
    // message.getMessages). Without this the client's optimistic isSupervisor flag
    // is lost on refetch and the supervisor renders as a generic assistant.
    // The persisted message `role` stays 'assistant' — only metadata carries the
    // orchestration role, keeping the data training-friendly.
    const orchestrationMetadata = appContext?.orchestrationRole
      ? {
          ...(appContext.orchestrationRole === 'supervisor' ? { isSupervisor: true } : {}),
          orchestrationRole: appContext.orchestrationRole,
        }
      : undefined;

    // Assistant placeholder (shows the spinner in the UI). A hetero run seeds
    // ONLY the provider — the CLI reports the real model later via `stream_start`
    // / `turn_metadata` (backfilled by HeterogeneousPersistenceHandler), and
    // seeding the agent's chat model would leak it into the model tag. A normal
    // run seeds model + provider as usual.
    const assistantParentId = userMessageRecord?.id ?? batchApprovalAnchorId ?? parentMessageId;
    const existingContinuationAssistant = continuationAssistantId
      ? await this.messageModel.findById(continuationAssistantId)
      : undefined;

    if (
      existingContinuationAssistant &&
      (existingContinuationAssistant.role !== 'assistant' ||
        existingContinuationAssistant.topicId !== topicId ||
        (existingContinuationAssistant.threadId ?? undefined) !==
          (appContext?.threadId ?? undefined) ||
        (existingContinuationAssistant.parentId ?? undefined) !== assistantParentId ||
        existingContinuationAssistant.agentId !== assistantAgentId)
    ) {
      throw new Error(
        `Intervention continuation assistant identity conflict: ${continuationAssistantId}`,
      );
    }

    const assistantMessageRecord =
      existingContinuationAssistant ??
      (await this.messageModel.create(
        {
          agentId: assistantAgentId,
          content: LOADING_FLAT,
          // Stamp groupId so the assistant turn is visible in the group read path
          // (MessageModel.query filters group chats by messages.groupId).
          groupId: appContext?.groupId ?? undefined,
          metadata: orchestrationMetadata,
          model: isHeteroAgent ? undefined : model,
          // Chain onto the user turn we just persisted; `parentMessageId` is the
          // anchor only on a resume, where no user message is created. A batch
          // approval overrides it with the assistant that emitted the batch — the
          // previous LLM call — so the spine stays one node per call and never
          // depends on which of the batch's tool rows the client sent as anchor.
          parentId: assistantParentId,
          provider: isHeteroAgent ? heteroType : provider,
          role: 'assistant',
          threadId: appContext?.threadId ?? undefined,
          topicId,
        },
        // Generic intervention continuations use a stable placeholder so a
        // crash after this insert but before operation-state creation can
        // safely re-enter without creating a second assistant turn.
        continuationAssistantId ?? clientIds?.assistantMessageId,
      ));
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
      // Same structured shape as the built-in path (`op_{ts}_{agentId}_{topicId}_{rand}`)
      // so hetero ops aren't visually distinct bare nanoids in the trace/op tables.
      const operationId = `op_${Date.now()}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

      // Persist a first-class agent_operations row for the hetero run. The id is
      // generated here (authoritative) and flows through to heteroIngest /
      // heteroFinish unchanged. Without this row the run is invisible to the
      // operation lifecycle: verify (ensureForOperation), repair (parent chain),
      // judge (op.model/provider) and tracing all key off it. The durable row is
      // also an authentication prerequisite: every callback
      // re-authorizes its operation token against this exact principal. Do not
      // mint a token or dispatch/spawn when persistence fails.
      const operationPersisted = await new CompletionLifecycle(
        this.db,
        this.userId,
        this.workspaceId,
      ).recordStart({
        agentId: persistAgentId,
        chatGroupId: appContext?.groupId ?? null,
        maxSteps,
        operationId,
        parentOperationId,
        provider: heteroType,
        taskId: operationTaskId ?? null,
        threadId: appContext?.threadId ?? null,
        topicId,
        trigger,
      });
      if (!operationPersisted) {
        throw new Error('Failed to persist heterogeneous agent operation');
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
        operationJwt = await signHeteroOperationJWT({
          capabilities: ['hetero:ingest', 'hetero:finish', 'hetero:intervention:read'],
          operationId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        });
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
        const marketService = await this.getMarketService();
        // Inside a workspace, the GitHub cred must come from the workspace's shared
        // organization credentials, not the operator's personal creds.
        const credsAccessor = this.workspaceId
          ? marketService.market.organizations.creds({ workspaceId: this.workspaceId })
          : marketService.market.creds;
        const list = await credsAccessor.list();
        const cred = list.data?.find((c: { key: string }) => c.key === githubCredKey);
        if (cred) {
          const full = await credsAccessor.get(cred.id, { decrypt: true });
          const vals = (full as any).plaintext ?? (full as any).values ?? {};
          githubToken = vals.access_token ?? vals.token;
        }
      } catch (err) {
        log('execAgent: failed to resolve GitHub token: %O', err);
      }

      // Recovery history is reserved for the CLI's retry without native resume.
      // The primary resumed attempt already has native history and must not get
      // a serialized duplicate. Amp threads are server-backed, so they rely on
      // native continuation exclusively and never need this local-file fallback.
      let conversationHistory: ConversationHistoryEntry[] | undefined;
      if (heteroType !== 'amp') {
        try {
          const recentMsgs = await this.messageModel.query({ topicId, pageSize: 200 });
          const turns = recentMsgs
            .filter(
              (m) =>
                (m.role === 'user' || m.role === 'assistant') &&
                !m.threadId &&
                !selfMessageIds.has(m.id) &&
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

      // Build the primary context without conversation history. If native resume
      // fails, the CLI switches to the complete fallback prompt on its fresh
      // retry; successful same-session runs never consume the duplicate history.
      const systemContext = buildCloudHeteroContext({
        agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
        conversationHistory: resumeSessionId ? undefined : conversationHistory,
        githubToken,
        repos: topicRepos,
      });
      const resumeFallbackSystemContext =
        resumeSessionId && conversationHistory
          ? buildCloudHeteroContext({
              agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
              conversationHistory,
              githubToken,
              repos: topicRepos,
            })
          : undefined;

      // Feed the resolved images (signed URLs) to the dispatched CLI for vision —
      // mirrors the local-mode path, where the client feeds the persisted
      // message's imageList into `sendPrompt`. Reuses the shared resolution above
      // so bot/IM and SPA gateway attachments are handled identically.
      const heteroImageList =
        runAttachments.imageList && runAttachments.imageList.length > 0
          ? runAttachments.imageList.map((image) => ({ id: image.id, url: image.url }))
          : undefined;
      const heteroExecArgs = isLocalHeterogeneousType(heteroType)
        ? buildHeteroExecArgs(
            heterogeneousProvider?.type === heteroType
              ? applyTopicModelToHeterogeneousProvider(
                  heterogeneousProvider,
                  pinnedHeterogeneousTopicModel,
                )
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
        resumeFallbackSystemContext,
        resumeSessionId,
        systemContext,
        topicId,
        userId: this.userId,
      };

      const platformPlan = isRemoteHetero
        ? resolveExecutionPlan({
            agencyConfig: agentConfig.agencyConfig,
            canUseDevice,
            clientExecutionAvailable: Boolean(localDeviceId),
            isHetero: true,
            localDeviceId,
            requestedDeviceId: effectiveRequestedDeviceId,
            sandboxExecutionAvailable: false,
            trigger: requestTriggerMetadata?.trigger,
            workspaceScoped: resolveWorkspaceScoped(
              isPublicWorkspaceAgent && !canManageAgent,
              memberDeviceOverride,
            ),
          })
        : undefined;
      const remoteDeviceId = platformPlan?.kind === 'device' ? platformPlan.deviceId : undefined;
      const remoteDeviceWorkspaceId = remoteDeviceId
        ? await this.resolveDeviceWorkspaceId(remoteDeviceId)
        : undefined;
      const usesCallersPersonalDevice =
        platformPlan?.kind === 'device' &&
        !remoteDeviceWorkspaceId &&
        (effectiveRequestedDeviceId === remoteDeviceId ||
          (platformPlan.target === 'local' &&
            agentConfig.agencyConfig?.executionTargetSelectionPolicy !== 'fixed') ||
          (!canManageAgent && memberDeviceOverride?.boundDeviceId === remoteDeviceId));
      const remoteDeviceUserId = usesCallersPersonalDevice
        ? this.userId
        : (agentConfig.userId ?? this.userId);

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
      const childOperation = {
        assistantMessageId: assistantMessageRecord.id,
        heteroType,
        hooks: serializedHooks,
        startedAt: new Date().toISOString(),
        ...(isRemoteHetero && remoteDeviceId
          ? {
              deviceId: remoteDeviceId,
              deviceUserId: remoteDeviceUserId,
              deviceWorkspaceId: remoteDeviceWorkspaceId,
            }
          : {}),
        operationId,
        orchestrationRole: appContext?.orchestrationRole,
        scope: appContext?.scope ?? undefined,
        threadId: appContext?.threadId ?? undefined,
      };
      if (params.topicStartOwnerOperationId) {
        const attached = await this.topicModel.appendRunningOperationChild(
          topicId,
          params.topicStartOwnerOperationId,
          childOperation,
        );
        if (!attached) {
          const message = 'Group supervisor finished before this member could start.';
          await new CompletionLifecycle(this.db, this.userId, this.workspaceId).completeOperation(
            {
              agentId: persistAgentId,
              assistantMessageId: assistantMessageRecord.id,
              error: { message, type: 'AgentRuntimeError' },
              operationId,
              orchestrationRole: appContext?.orchestrationRole,
              serializedHooks,
              topicId,
              userId: this.userId,
            },
            'error',
          );
          return {
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            autoStarted: false,
            createdAt: new Date().toISOString(),
            error: message,
            message,
            operationId,
            status: 'error',
            success: false,
            timestamp: new Date().toISOString(),
            topicId,
            userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
          };
        }
      } else if (appContext?.isolationThread && parentOperationId) {
        // Isolation-thread children (callAgent / callSubAgent) run on the
        // SPAWNER's topic and finish long before it does. heteroIngest and
        // heteroFinish both require this child's operationId to resolve via
        // topic.metadata.runningOperation (root or childOperations) — see
        // the comment above childOperation — or every streamed batch is
        // dropped as stale and the terminal onComplete hooks (including the
        // callAgent resume bridge) never fire. Nest under the parent's own
        // marker instead of claiming the topic-level root outright, so the
        // parent's marker survives for the rest of its still-running turn.
        const attachedToParent = await this.topicModel.appendRunningOperationChild(
          topicId,
          parentOperationId,
          childOperation,
        );
        if (!attachedToParent) {
          // Parent isn't (or is no longer) the topic's current root marker —
          // e.g. a nested isolation chain, or the parent already settled.
          // Fall back to claiming the marker directly so this child is still
          // discoverable by its own operationId, rather than permanently
          // unrecognized by heteroIngest/heteroFinish.
          await this.topicModel.updateMetadata(topicId, { runningOperation: childOperation });
        }
      } else if (!appContext?.isolationThread) {
        await this.topicModel.updateMetadata(topicId, { runningOperation: childOperation });
      }

      // Always persist operation metadata (userId/workspaceId) to the state
      // manager, not just for topic-owner-mirrored runs. `subAgentCallback`
      // (the QStash-delivered completion bridge for callAgent/callSubAgent
      // children) resolves `userId` from this same store to authorize
      // resuming the parent — without it, a hetero child spawned via
      // callAgent has no metadata row, the callback 401s, and the parent
      // operation is never resumed (stays parked until the inactivity
      // watchdog abandons it).
      const persistOperationMetadata = async () => {
        try {
          await createAgentStateManager().createOperationMetadata(operationId, {
            ...(params.topicStartOwnerOperationId && {
              mirrorToOperationId: params.topicStartOwnerOperationId,
            }),
            userId: this.userId,
            workspaceId: this.workspaceId,
          });
        } catch (err) {
          log('execAgent: failed to persist hetero operation metadata: %O', err);
        }
      };

      if (agentConfig.agencyConfig?.heterogeneousProvider?.authMode === 'api') {
        await this.finalizeHeteroDispatchError({
          agentId: resolvedAgentId,
          assistantMessageId: assistantMessageRecord.id,
          detail: HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
          message: 'Provider-bound heterogeneous agents do not support this execution target',
          operationId,
          topicId,
        });
        return {
          agentId: resolvedAgentId,
          assistantMessageId: assistantMessageRecord.id,
          autoStarted: false,
          createdAt: new Date().toISOString(),
          error: HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
          message: 'Heterogeneous agent provider binding requires Desktop local execution',
          operationId,
          status: 'error',
          success: false,
          timestamp: new Date().toISOString(),
          topicId,
          userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
        };
      }

      // Notify-based platform agents (openclaw / hermes) communicate back via
      // agentNotify.notify. A local run uses the requesting desktop's device ID;
      // a remote run uses agencyConfig.boundDeviceId. Both use the gateway transport,
      // so open the stream before the first notify arrives.

      if (isRemoteHetero) {
        // Platform task agents require either this desktop or a connected device — there is no sandbox to
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
          log('execAgent: openclaw/hermes requires a local or connected device');
          await this.finalizeHeteroDispatchError({
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            detail: 'No local or connected device is available for this agent.',
            message: 'No execution device for platform agent',
            operationId,
            topicId,
          });
          return {
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            autoStarted: false,
            createdAt: new Date().toISOString(),
            error: 'No bound device',
            message: 'Platform agent requires a local or connected device',
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
        await persistOperationMetadata();
        const streamManager = createStreamEventManager();
        await streamManager
          .publishAgentRuntimeInit(operationId, {
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            heteroType,
            mirrorToOperationId: params.topicStartOwnerOperationId,
            topicId,
            userId: this.userId,
          })
          .catch((err) => log('execAgent: failed to init stream for remote hetero: %O', err));

        // lh connect only handles tool_call_request (not agent_run_request),
        // so we use executeToolCall with the runHeteroTask tool instead of dispatchAgentRun.
        const result = await deviceGateway.executeToolCall(
          {
            deviceId: remoteDeviceId,
            userId: remoteDeviceUserId,
            workspaceId: remoteDeviceWorkspaceId,
          },
          {
            apiName: 'runHeteroTask',
            arguments: JSON.stringify({
              agentId: resolvedAgentId,
              agentType: heteroType,
              cwd: undefined,
              operationId,
              parentOperationId: params.topicStartOwnerOperationId,
              platformAgentId: agentConfig.agencyConfig?.heterogeneousProvider?.platformAgentId,
              prompt,
              taskId: operationId,
              topicId,
              // Scope notify callbacks to the same workspace as the dispatched
              // topic so agentNotify can resolve the workspace-owned topic.
              // Without this the device's notify call falls back to personal
              // mode and TopicModel.findById returns NOT_FOUND.
              workspaceId: this.workspaceId,
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
            errorType: resolveHeteroDispatchErrorType(result.error),
            message: humanizeHeteroDispatchError(result.error),
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
        // Local CLI hetero (Amp / Claude Code / Codex / Kimi Code / OpenCode /
        // Pi / Qoder) — fork between device dispatch and cloud sandbox via the
        // shared execution plan:
        //   - requestedDeviceId (topic-level override) always wins
        //   - executionTarget 'device' → dispatch to boundDeviceId (errors if unset)
        //   - executionTarget 'local' + boundDeviceId (desktop sync opened on web)
        //     → dispatch to that device
        //   - everything else ('sandbox' / unbound 'local' / 'none' / unset) → cloud
        //     sandbox when the provider supports it; Amp and OpenCode remain
        //     unrouted because they require a local or connected device
        // `onlineDeviceIds` is intentionally omitted: hetero dispatch trusts
        // the binding and fails loudly at the gateway if the device is offline.
        // `canUseDevice` degrades device-capable targets to the sandbox when
        // available, or leaves device-only providers unrouted, for denied
        // senders (e.g. external bot users). Without this a synced local/device
        // binding would let them run on the owner's machine.

        // Register the op with the agent-gateway DO before dispatch, mirroring
        // the remote-hetero branch above. Local CLI hetero (claude-code / codex)
        // streams back via heteroIngest, which forwards live events the DO can
        // relay even without an init — so the FIRST run renders fine. But a later
        // `reconnectToGatewayOperation` (task topic drawer open / page reload)
        // sends a `resume` that asks the DO for the op's status; with no session
        // record the DO answers terminal, the client fires `session_complete`,
        // and `onSessionComplete` clears `topic.metadata.runningOperation`. The
        // still-running CC's next heteroIngest batch then hits
        // StaleHeteroOperationError and is silently dropped — the agent appears
        // to stop the moment the window is opened. Seeding the init keeps the DO
        // reporting `running`, so resume stays connected and keeps streaming.
        // Best-effort: a stream-manager/Redis failure must never block dispatch —
        // the init only powers reconnect, not the run. `createStreamEventManager`
        // probes Redis synchronously, so guard construction too, not just publish.
        try {
          await persistOperationMetadata();
          await createStreamEventManager().publishAgentRuntimeInit(operationId, {
            agentId: resolvedAgentId,
            assistantMessageId: assistantMessageRecord.id,
            heteroType,
            mirrorToOperationId: params.topicStartOwnerOperationId,
            topicId,
            userId: this.userId,
          });
        } catch (err) {
          log('execAgent: failed to init stream for local hetero: %O', err);
        }

        const heteroPlan = resolveExecutionPlan({
          agencyConfig: agentConfig.agencyConfig,
          canUseDevice,
          isHetero: true,
          clientExecutionAvailable: false,
          requestedDeviceId,
          sandboxExecutionAvailable: supportsCloudHeterogeneousSandbox(heteroType),
          trigger: requestTriggerMetadata?.trigger,
        });

        if (heteroPlan.kind !== 'sandbox') {
          const dispatchDeviceId = heteroPlan.kind === 'device' ? heteroPlan.deviceId : undefined;
          if (!dispatchDeviceId) {
            log('execAgent: hetero executionTarget=device but no boundDeviceId set');
            await this.finalizeHeteroDispatchError({
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              detail: !supportsCloudHeterogeneousSandbox(heteroType)
                ? 'No device bound. Pick a local or connected device in the Execution Device switcher.'
                : 'No device bound. Pick a device in the Execution Device switcher, or switch to Cloud sandbox.',
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
          const deviceCwdConfig = resolveDeviceWorkingDirectoryConfig({
            deviceDefaultCwd: boundDevice?.defaultCwd,
            deviceId: dispatchDeviceId,
            initialWorkingDirectory: appContext?.initialTopicMetadata?.workingDirectory,
            initialWorkingDirectoryConfig: appContext?.initialTopicMetadata?.workingDirectoryConfig,
            topicWorkingDirectory: topic?.metadata?.workingDirectory,
            topicWorkingDirectoryConfig: topic?.metadata?.workingDirectoryConfig,
            workingDirByDevice: agentConfig.agencyConfig?.workingDirByDevice,
          });
          const deviceCwd = getWorkingDirEffectivePath(deviceCwdConfig);

          // An unbound topic has no pinned cwd yet: the directory was only
          // recorded at agent level (`workingDirByDevice`) when no topic existed.
          // Persist the resolved cwd onto the topic so the sidebar groups it
          // under the right project and the next turn reuses the same directory.
          await this.bindTopicWorkingDirectory({
            config: deviceCwdConfig,
            currentWorkingDirectory: topic?.metadata?.workingDirectory,
            topicId,
          });

          // Build only device-relevant context instead of reusing the cloud-sandbox one
          // (which describes an ephemeral /workspace + pre-cloned repos and would mislead
          // the agent). The spawned CLI already receives deviceCwd as its actual cwd.
          const deviceSystemContext = buildRemoteDeviceHeteroContext({
            agentSystemContext: agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
            conversationHistory: resumeSessionId ? undefined : conversationHistory,
          });
          const deviceResumeFallbackSystemContext =
            resumeSessionId && conversationHistory
              ? buildRemoteDeviceHeteroContext({
                  agentSystemContext:
                    agentConfig.agencyConfig?.heterogeneousProvider?.systemContext,
                  conversationHistory,
                })
              : undefined;

          const result = await deviceGateway.dispatchAgentRun({
            ...heteroParams,
            args: heteroExecArgs,
            cwd: deviceCwd,
            deviceId: dispatchDeviceId,
            resumeFallbackSystemContext: deviceResumeFallbackSystemContext,
            systemContext: deviceSystemContext,
            // Route to the workspace pool when this is a workspace device; the
            // operation JWT stays member-scoped (the run belongs to the member).
            workspaceId: dispatchWorkspaceId,
            // Topic scope for device-side heteroIngest/heteroFinish. Distinct
            // from the routing workspace above: a workspace topic on a personal
            // device still has to write back under `this.workspaceId`.
            ingestWorkspaceId: this.workspaceId,
          });
          if (!result.success) {
            log('execAgent: hetero device dispatch failed: %s', result.error);
            await this.finalizeHeteroDispatchError({
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              detail: result.error ?? 'Device dispatch failed',
              errorType: resolveHeteroDispatchErrorType(result.error),
              message: humanizeHeteroDispatchError(result.error),
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
          if (!supportsCloudHeterogeneousSandbox(heteroType)) {
            const message = `${getHeterogeneousAgentTitle(heteroType)} requires a local or connected device; cloud sandbox execution is not supported.`;
            await this.finalizeHeteroDispatchError({
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              detail: message,
              message,
              operationId,
              topicId,
            });
            return {
              agentId: resolvedAgentId,
              assistantMessageId: assistantMessageRecord.id,
              autoStarted: false,
              createdAt: new Date().toISOString(),
              error: message,
              message,
              operationId,
              status: 'error',
              success: false,
              timestamp: new Date().toISOString(),
              topicId,
              userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
            };
          }

          // Cloud sandbox path — only for sandbox-provisioned local CLI agents.
          // Remote agents (openclaw / hermes) always require a bound device.
          // Lazy-loaded on purpose: `sandboxRunner` pulls the sandbox-service graph
          // (which eagerly touches server-only ModelRuntime env at module init), so
          // importing it statically would couple that whole subsystem into every
          // `aiAgent` import. Only this cloud-CLI branch needs it.
          const { spawnHeteroSandbox } =
            await import('@/server/services/heterogeneousAgent/sandboxRunner');
          const marketService = await this.getMarketService();
          // The sandbox authenticates its nested `lh` calls with this JWT. The
          // narrow `hetero-operation` token (used for the device-dispatch path
          // above) is rejected by `oidcAuth`, so CC capabilities that hit
          // user-scoped endpoints — e.g. uploading a `Read`-on-image result to
          // the file store for thumbnail echo — would 401 and silently drop.
          // Mint a user-scoped `cli-sandbox` token instead (still `sub: userId`,
          // ownership-gated on heteroIngest/heteroFinish) with a run-length TTL
          // so it outlives a multi-hour run.
          const sandboxJwt = await signUserJWT(this.userId, '4h');
          spawnHeteroSandbox({
            ...heteroParams,
            agentType: heteroType as 'claude-code' | 'codex',
            args: heteroExecArgs,
            jwt: sandboxJwt,
            marketService,
            workspaceId: this.workspaceId,
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
      if (!this.withholdGatewayToken) {
        try {
          gatewayToken = await signUserJWT(this.userId);
        } catch {
          // non-critical
        }
      }

      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: true,
        createdAt: new Date().toISOString(),
        heteroType,
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
    let enableExpertise = false;
    let userTimezone: string | undefined;
    // Resolved once below (alongside the group-tool authorization fetch) and
    // forwarded into op metadata for the per-step context engine.
    let operationAgentGroup: AgentGroupConfig | undefined;
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
    try {
      const preference = await new UserModel(this.db, this.userId).getUserPreference();
      enableExpertise = preference?.lab?.enableSelfLearning === true;
    } catch (error) {
      console.error('Failed to resolve expertise injection Lab preference:', error);
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
    const isBotConversation = !!(botContext || discordContext);

    // Device-tool access (`canUseDevice` / `deviceAccessReason`) was resolved
    // once before the hetero early exit above; the decision flows into the
    // engine's enable gates (LocalSystem / RemoteDevice) and the RemoteDevice
    // systemRole injection below.

    // These are needed outside the tools block (for agent management context, skill engine, etc.)
    let lobehubSkillManifests: LobeToolManifest[] = [];
    let composioManifests: LobeToolManifest[] = [];
    let connectorManifests: ReturnType<typeof buildConnectorManifests> = [];
    // When the user @-mentions agents (multi-mention, non-group), enable the
    // agent-management tool for this run so the supervisor can `callAgent` to
    // delegate. Mirrors the client runtime, which injects a callAgent manifest.
    // Single-mention takes a client-only deterministic-router path and never
    // reaches here. The delegation *context* (which agents were mentioned) is
    // injected separately via `initialContext.mentionedAgents` below.
    const hasMentionedAgents = !appContext?.groupId && !!mentionedAgents?.length;

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
      new AiModelModel(this.db, this.userId, this.workspaceId).findByIdAndProvider(model, provider),
      new AiProviderModel(this.db, this.userId, this.workspaceId).findById(provider),
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
        const tree = await this.messageModel.queryTopicMessageTree({
          threadId: appContext.threadId,
          topicId: appContext.topicId,
        });
        historyMessagesCache = pruneRegeneratedBranch(historyMessagesCache, tree, parentMessageId);
      }

      return historyMessagesCache;
    };

    if (params.disableTools) {
      log('execAgent: tools disabled by disableTools flag, skipping all tool discovery');
    } else {
      // 5a. Get installed plugins from database. Disabled identifiers are
      // excluded from this candidate pool entirely — not just from the pinned
      // `rules` allowlist — because `createEnableChecker`'s explicit-activation
      // bypass (auto activator) short-circuits before rules are consulted, so a
      // present-but-rule-disabled manifest could still be auto-activated.
      const disabledPluginIdSet = new Set(disabledPluginIds);
      const installedPlugins = (await this.pluginModel.query()).filter(
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
          ? await this.connectorModel.resolveByIdentifiers(
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
        const borrowed = collectBorrowedConnectors(connectors, this.userId!);
        if (borrowed.length > 0) {
          const displayMap = await resolveUserDisplayMap(
            this.db,
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
          ? await this.connectorToolModel.queryAllByConnectorIds(connectorsMcp.map((c) => c.id))
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
        // same `connectorGateKeeper` used above. `this.connectorModel` has none,
        // which would decrypt to null and make an authed connector 401 → error.
        const refreshConnectorModel = connectorGateKeeper
          ? new ConnectorModel(this.db, this.userId, this.workspaceId, connectorGateKeeper)
          : this.connectorModel;
        scheduleStaleConnectorToolsRefresh(connectorsMcp, buildLastSyncedAtMap(connectorTools), {
          connectorModel: refreshConnectorModel,
          connectorToolModel: this.connectorToolModel,
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
        const marketService = await this.getMarketService();
        lobehubSkillManifests = await marketService.getLobehubSkillManifests();
      } catch (error) {
        log('execAgent: failed to fetch lobehub skill manifests: %O', error);
      }
      log('execAgent: got %d lobehub skill manifests', lobehubSkillManifests.length);

      // 5d. Fetch Composio tool manifests from database
      try {
        composioManifests = await this.composioService.getComposioManifests(resolvedAgentId);
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
              ? await this.connectorModel.resolveByIdentifiers(allIdentifiers, resolvedAgentId)
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
          // Personal pool ∪ the current workspace pool, DB rows ⊕ gateway online,
          // tagged with `scope` and the user-set `friendlyName` alias (see
          // `getScopedOnlineDevices`) so the systemRole snapshot lets the model
          // tell a personal machine apart from its workspace-enrolled counterpart
          // (same physical machine under both principals). Keep only live devices:
          // downstream `onlineDeviceIds` / `deviceOnline` treat this list as the
          // online set.
          onlineDevices = (
            await getScopedOnlineDevices(this.db, this.userId, this.workspaceId)
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
          if (this.workspaceId && agentConfig.agencyConfig?.boundDeviceId) {
            const boundId = agentConfig.agencyConfig.boundDeviceId;
            const alreadyIncluded = onlineDevices.some((d) => d.deviceId === boundId);
            if (!alreadyIncluded) {
              const personalPool = await getScopedOnlineDevices(this.db, this.userId).catch(
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
        trigger: requestTriggerMetadata?.trigger,
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
          executionPlan.kind === 'device-unrouted' &&
          executionPlan.reason === 'bound-device-offline'
            ? 'The device fixed by this agent is offline. Ask an editor to bring it online or change the agent device policy.'
            : 'The device fixed by this agent is unavailable for this run. Ask an editor to check the agent device policy.';
        await this.messageModel.update(assistantMessageRecord.id, {
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
          userId: this.userId,
        });
      }

      // Resolve the operation's group context ONCE here and snapshot it into op
      // metadata below — the per-step context engine reads it back without a DB
      // lookup, mirroring agentConfig/botContext. The same roster fetch also
      // authorizes the group-orchestration toolset.
      let isGroupSupervisor = false;
      if (appContext?.groupId) {
        const chatGroupModel = new ChatGroupModel(this.db, this.userId, this.workspaceId);
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
        // Scope the gateway lookup to the principal that owns the connection:
        // workspace devices need workspaceId; personal devices (including a
        // workspace run routed to the caller's own machine) must not.
        const systemInfo = await deviceGateway.queryDeviceSystemInfo(
          this.userId,
          deviceId,
          activeDeviceScope === 'workspace' ? this.workspaceId : undefined,
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

    // 15. Generate operation ID: agt_{timestamp}_{agentId}_{topicId}_{random}
    const timestamp = Date.now();
    const operationId =
      continuationOperationId ?? `op_${timestamp}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

    if (params.topicStartOwnerOperationId) {
      const attached = await this.topicModel.appendRunningOperationChild(
        topicId,
        params.topicStartOwnerOperationId,
        {
          assistantMessageId: assistantMessageRecord.id,
          operationId,
          orchestrationRole: appContext?.orchestrationRole,
          scope: appContext?.scope ?? undefined,
          threadId: appContext?.threadId ?? undefined,
        },
      );
      if (!attached) {
        const errorMessage = 'Group supervisor finished before this member could start.';
        await updateAbortedAssistantMessage(errorMessage);
        return {
          agentId: resolvedAgentId,
          assistantMessageId: assistantMessageRecord.id,
          autoStarted: false,
          createdAt: new Date().toISOString(),
          error: errorMessage,
          message: errorMessage,
          operationId,
          status: 'error',
          success: false,
          timestamp: new Date().toISOString(),
          topicId,
          userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
        };
      }
    }

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

    // 16b. Human-approval resume — override initialContext based on the
    // user's decision. The DB write above has already persisted the
    // intervention status, so `allMessages` reflects the decision for the
    // LLM / runner on the first step.
    //
    // `rejected` and `rejected_continue` share the same persisted tool-result
    // path. Starting at `tool_result` (not `user_input`) is critical for a
    // partial same-turn decision: GeneralChatAgent first checks for pending
    // siblings and re-parks them, and only the final decision continues the
    // LLM. A direct user_input continuation would fork an LLM call while the
    // unresolved tool rows were still empty.
    // Batch approval: hand the runtime every approved tool at once so it runs a
    // single `call_tools_batch` against the existing pending rows and continues
    // the LLM exactly once, with the complete result set. Taken whenever the
    // caller used the batch wire form; the single `resumeApproval` form keeps
    // the established `call_tool` + `skipCreateToolMessage` path below.
    if (resumeApprovals?.length) {
      initialContext =
        approvedToolEntries.length > 0
          ? {
              initialContext: initialContext.initialContext,
              payload: {
                approvedToolCalls: approvedToolEntries.map(({ plugin }) => ({
                  apiName: plugin.apiName,
                  arguments: plugin.arguments,
                  id: plugin.toolCallId,
                  identifier: plugin.identifier,
                  type: plugin.type ?? 'default',
                })),
                assistantMessageId: assistantMessageRecord.id,
                // The tool rows already exist and are parented to the assistant that
                // emitted the calls; the batch executor addresses them through
                // `toolMessageIds` and never inserts, so this only anchors the spine.
                parentMessageId: approvalOwnerAssistantId ?? assistantMessageRecord.id,
                toolMessageIds: Object.fromEntries(
                  approvedToolEntries
                    .filter(({ plugin }) => !!plugin.toolCallId)
                    .map(({ plugin, toolMessageId }) => [plugin.toolCallId!, toolMessageId]),
                ),
              } as any,
              phase: 'human_approved_tool' as const,
              session: {
                messageCount: allMessages.length,
                sessionId: operationId,
                status: 'idle' as const,
                stepCount: 0,
              },
            }
          : {
              initialContext: initialContext.initialContext,
              payload: {
                assistantMessageId: assistantMessageRecord.id,
                parentMessageId: parentMessageId ?? resumeApprovals[0].parentMessageId,
              } as any,
              phase: 'tool_result' as const,
              session: {
                messageCount: allMessages.length,
                sessionId: operationId,
                status: 'idle' as const,
                stepCount: 0,
              },
            };
    } else if (resumeApproval && resumeApprovalPlugin) {
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
          initialContext: initialContext.initialContext,
          payload: {
            assistantMessageId: assistantMessageRecord.id,
            parentMessageId: resumeApproval.parentMessageId,
          } as any,
          phase: 'tool_result' as const,
          session: {
            messageCount: allMessages.length,
            sessionId: operationId,
            status: 'idle' as const,
            stepCount: 0,
          },
        };
      }
    }

    // 16c. Human-answer resume — resume from the persisted tool result WITHOUT
    // re-executing the tool. The DB write above (2.7) already set the tool
    // message content to the human answer, so `allMessages` reflects it. Using
    // `phase: 'tool_result'` (not `human_approved_tool`) makes the runner
    // continue the loop from the answered tool call rather than dispatching a
    // fresh `call_tool` — which would overwrite the answer with a new "pending"
    // result. Mirrors the client's tool-result-only resume path.
    if (resumeToolResult) {
      initialContext = {
        initialContext: initialContext.initialContext,
        payload: {
          assistantMessageId: assistantMessageRecord.id,
          parentMessageId: resumeToolResult.parentMessageId,
        } as any,
        phase: 'tool_result' as const,
        session: {
          messageCount: allMessages.length,
          sessionId: operationId,
          status: 'idle' as const,
          stepCount: 0,
        },
      };
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

    // Bind the topic to that very directory. A native (non-hetero) agent
    // routed to a device used to resolve its cwd here for the prompt and the
    // tools, but never write it back — so its topics stayed unbound while the
    // run itself executed in the right place. Awaited (not fire-and-forget):
    // the tool layer reads the topic's cwd on the same run.
    await this.bindTopicWorkingDirectory({
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
      const skillModel = new AgentSkillModel(this.db, this.userId, this.workspaceId);
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
      const agentSkills = await this.agentDocumentsService.getAgentSkills(resolvedAgentId);
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
      const expertiseModel = new ExpertiseModel(this.db, this.userId, this.workspaceId);
      expertise = await buildExpertiseContextSnapshot(expertiseModel, expertiseAgentId);
    } catch (error) {
      console.error('Failed to build expertise snapshot for agent:', expertiseAgentId, error);
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
        activeDeviceScope,
        agentConfig,
        agentGroup: operationAgentGroup,
        deviceSystemInfo: Object.keys(deviceSystemInfo).length > 0 ? deviceSystemInfo : undefined,
        executionPlan,
        searchDecision,
        userTimezone,
        appContext: {
          // Background self-iteration runs execute under a builtin slug (so they
          // inherit the builtin agent's tools / systemRole / model), but their
          // resource tools and receipts must attribute to the *reviewed* user
          // agent, which rides on the marker. Prefer it so the tool-execution
          // context (state.metadata.agentId) targets the reviewed agent; ordinary
          // runs (no marker) fall back to the resolved executing agent.
          agentId: appContext?.agentSignal?.agentId ?? resolvedAgentId,
          // Propagate the originating request's client IP / user agent into
          // state.metadata (via the `...appContext` spread in createOperation) so
          // downstream LLM-call metadata can carry them for auditing and spend
          // attribution.
          clientIp,
          userAgent,
          // When scope === 'agent_builder', agentId stays as the builder builtin so
          // message ownership and queryUiMessages remain correct. editingAgentId
          // carries the actual editing target separately; only the AgentBuilder server
          // runtime reads it, keeping the rest of the pipeline unaffected.
          ...(appContext?.scope === 'agent_builder' && appContext?.editingAgentId
            ? { editingAgentId: appContext.editingAgentId }
            : {}),
          // Mirror of the above for the Group Agent Builder panel: the run is
          // owned by the builtin builder agent, so the edited group only rides
          // here. Read by the group-agent-builder server runtime and by the
          // `<current_group_context>` injector.
          ...(appContext?.scope === 'group_agent_builder' && appContext?.editingGroupId
            ? { editingGroupId: appContext.editingGroupId }
            : {}),
          // Run-scoped Agent Signal marker for background self-iteration / memory
          // runs — lands in state.metadata.agentSignal so the completion path can
          // project receipts/briefs. Undefined for ordinary chat runs.
          ...(appContext?.agentSignal ? { agentSignal: appContext.agentSignal } : {}),
          defaultTaskAssigneeAgentId: appContext?.defaultTaskAssigneeAgentId,
          documentId: appContext?.documentId,
          groupId: appContext?.groupId,
          isSubAgent: appContext?.isSubAgent,
          // Persist the orchestration role on state.metadata so the
          // inactivity-watchdog abandon path can distinguish an isolated group
          // member ('member') from a genuine callSubAgent child.
          orchestrationRole: appContext?.orchestrationRole,
          scope: appContext?.scope,
          sessionId: appContext?.sessionId,
          sourceMessageId: userMessageRecord?.id ?? parentMessageId ?? undefined,
          // Live-progress anchor for a callSubAgent child — carries the parked
          // parent's operationId + placeholder tool message so the child's step
          // loop can stream its running totals down the parent's gateway channel.
          subAgentProgress: appContext?.subAgentProgress,
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
        evalRuntime,
        enableExpertise,
        expertise,
        initialContext,
        initialMessages: allMessages,
        initialStepCount,
        ...(providedApprovalResolutionRequestId && approvalSourceOperationId
          ? {
              interventionResolution: {
                resolutionRequestId: providedApprovalResolutionRequestId,
                sourceOperationId: approvalSourceOperationId,
                sourceToolMessageIds: [...approvalSourceToolMessageIds].sort(),
              },
            }
          : {}),
        ...(providedApprovalResolutionRequestId
          ? {
              onInterventionPrepared: () => {
                approvalClaim.continuationPrepared = true;
              },
            }
          : {}),
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
          activatableToolIds,
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
      approvalClaim.continuationStarted = true;

      // The approval continuation is a fresh operation. Legacy direct callers
      // retire the old parked runtime here, only after createOperation has
      // durably scheduled the replacement. Generic v2 calls carry a durable
      // resolution id and defer this transition to the shared router dispatch
      // boundary, which can retry it without losing this successful ExecAgent
      // result (and therefore the WebSocket subscription credentials).
      if (approvalSourceOperationId && !providedApprovalResolutionRequestId) {
        await this.retirePendingApprovalOperation(approvalSourceOperationId);
      }

      log('execAgent: created operation %s (autoStarted: %s)', operationId, result.autoStarted);

      // Persist running operation to topic metadata for reconnect after page reload.
      //
      // Skipped for isolation-thread children (callAgent / callSubAgent / group
      // members): they run on the SPAWNER's topic and finish long before it does,
      // so claiming the mark would first point every client reconnect at the
      // child's thread stream, and then — once the child finished and cleared it —
      // leave the still-running parent with no mark at all, i.e. no gateway
      // WebSocket for the rest of the run. The parent's mark stays authoritative;
      // a child's live progress already rides down the parent channel via
      // `appContext.subAgentProgress`.
      // `orchestrationRole` is public rendering metadata. Only the internally
      // propagated parent operation id proves child ownership of this topic.
      if (
        !appContext?.isolationThread &&
        !appContext?.threadId &&
        !params.topicStartOwnerOperationId
      ) {
        await this.topicModel.updateMetadata(topicId, {
          runningOperation: {
            assistantMessageId: assistantMessageRecord.id,
            heteroType: null,
            operationId,
            scope: appContext?.scope ?? undefined,
            // Liveness stamp — without it this marker can never be proven dead
            // and would hold the topic against background starts forever.
            startedAt: new Date().toISOString(),
            threadId: appContext?.threadId ?? undefined,
          },
        });
      }

      // Generate a short-lived JWT for Gateway WebSocket authentication
      let gatewayToken: string | undefined;
      if (!this.withholdGatewayToken) {
        try {
          gatewayToken = await signUserJWT(this.userId);
        } catch {
          log('execAgent: failed to sign gateway JWT, gateway auth will be unavailable');
        }
      }

      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: result.autoStarted,
        createdAt: new Date().toISOString(),
        heteroType: null,
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
      if (params.topicStartOwnerOperationId) {
        await this.topicModel.removeRunningOperationChild(topicId, operationId).catch(() => false);
      }
      if (isAbortError(error)) {
        await updateAbortedAssistantMessage(error.message);
        log('execAgent: createOperation aborted for %s: %s', operationId, error.message);
        throw error;
      }
      if (providedApprovalResolutionRequestId && approvalClaim.continuationPrepared) {
        // The source claim + deterministic state are now the retry record. A
        // queue ACK may have been accepted even when its HTTP response or our
        // follow-up marker write failed, so do not paint the stable assistant
        // as terminal error and do not collapse this into success:false.
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

    // 2. Delegate to execAgent with groupId in appContext.
    // execGroupAgent always runs the group's supervisor, so stamp the
    // orchestration role onto the run — it lands on the assistant message
    // metadata and drives supervisor-flavored UI rendering.
    const result = await this.execAgent({
      agentId,
      appContext: { groupId, orchestrationRole: 'supervisor', topicId },
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
      chatConfig: params.chatConfig,
      isSubAgent: true,
      logScope: 'execVirtualSubAgent',
      // Sub-agent model is resolved at the spawn site (callSubAgent runner) from
      // the parent agent's `agencyConfig.subagent` and threaded through here as an
      // explicit override, so execAgent never re-reads the parent config.
      model: params.model,
      provider: params.provider,
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
          // Tag the op as a group member so the abandon path routes its parent
          // resume through the group bridge (its own timeout), not the sub-agent one.
          orchestrationRole: 'member',
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
      supervisorMessageId,
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
      orchestrationRole: 'member',
      scope: 'group',
      topicId,
    };

    // The member runs as a child op of the supervisor and lands its turns in the
    // shared group conversation (no isolation thread). The bridge backfills the
    // member anchor (a short receipt) and resumes/finishes the supervisor.
    //
    // The member response attaches to the SUPERVISOR ASSISTANT message that owns
    // this group-management tool call (`supervisorMessageId`), NOT to the tool
    // message. For a multi-member broadcast the member assistants are therefore
    // siblings of the `agentCouncil` tool under one supervisor turn, and the
    // renderer groups them into a single parallel-streaming council card. The tool
    // message stays a pure result and the per-member anchors stay under it for the
    // K=N barrier only. This keeps the tool node clean and lets parallel speak/
    // broadcast turns render without the UI discontinuity the old tool-parented
    // shape caused. Falls back to the group tool message if no supervisor id was
    // threaded through (e.g. single-member collapses onto the tool anyway).
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
      parentMessageId: supervisorMessageId ?? groupToolMessageId,
      parentOperationId,
      prompt: speakerInstruction,
      suppressUserMessage: true,
      topicStartOwnerOperationId: parentOperationId,
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
      /**
       * chatConfig overrides (thinking / reasoning-effort extend params) for
       * the spawned run, merged over the executing agent's own chatConfig.
       * Only set by the callSubAgent path.
       */
      chatConfig?: Partial<LobeAgentChatConfig> | null;
      isSubAgent: boolean;
      logScope: 'execSubAgent' | 'execVirtualSubAgent';
      /**
       * Explicit model/provider override for the spawned run. The callSubAgent
       * spawn site resolves the sub-agent model from the parent agent's config
       * and passes it here; left undefined for group members (they keep their
       * own model).
       */
      model?: string;
      provider?: string;
      /**
       * Marks the run's orchestration role on its operation metadata. Isolated
       * group members pass `'member'` so the inactivity-watchdog abandon path can
       * tell them apart from genuine `callSubAgent` children — both share
       * `isSubAgent: true` and an isolation thread, but a member's parent is
       * resumed through the group K=N bridge (via its own group-member timeout),
       * NOT `completeSubAgentBridge`.
       */
      orchestrationRole?: 'member';
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

    // Live progress for a `callSubAgent` child: its per-step totals ride down the
    // parked parent's gateway channel (see `appContext.subAgentProgress`). Group
    // members are excluded — their whole stream is already mirrored onto the
    // supervisor's channel via `mirrorToOperationId`.
    const subAgentProgress =
      options.resumeParentOnComplete && parentOperationId && options.orchestrationRole !== 'member'
        ? { parentOperationId, toolMessageId: parentMessageId }
        : undefined;

    const appContext: NonNullable<InternalExecAgentParams['appContext']> = {
      groupId,
      // Every run spawned here executes in an isolation thread on the SPAWNER's
      // topic, so it must not touch that topic's `runningOperation` mark — that
      // mark is the main run's reconnect anchor (see execAgent).
      isolationThread: true,
      isSubAgent: options.isSubAgent,
      orchestrationRole: options.orchestrationRole,
      subAgentProgress,
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
      chatConfigOverride: options.chatConfig,
      hooks,
      // Explicit sub-agent model override resolved at the spawn site.
      model: options.model,
      parentOperationId,
      prompt: instruction,
      provider: options.provider,
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
   * Interrupts a running task and coordinates any device-hosted process shutdown.
   *
   * Call stack:
   *
   * execAgent (replacement path)
   *   -> {@link AiAgentService.interruptTask}
   *     -> deviceGateway.executeToolCall(cancelHeteroTask)
   *       -> HeterogeneousAgentCtr.cancelLhHeteroExec
   *
   * Use when:
   * - A user stops an agent runtime by thread or operation id.
   * - A replacement run must wait for a device-hosted native writer to exit.
   *
   * Expects:
   * - At least one of `threadId` or `operationId` resolves to an owned operation.
   *
   * Returns:
   * - Runtime cancellation status and, for local device agents, whether process exit was confirmed.
   */
  async interruptTask(params: {
    operationId?: string;
    threadId?: string;
    topicId?: string;
  }): Promise<{
    deviceCancellationConfirmed?: boolean;
    operationId?: string;
    success: boolean;
    threadId?: string;
  }> {
    const { threadId, operationId, topicId } = params;

    log('interruptTask: threadId=%s, operationId=%s', threadId, operationId);

    // 1. Get operationId and thread
    let resolvedOperationId = operationId;
    let thread;
    let deviceCancellationConfirmed: boolean | undefined;

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

    // Not every cancellation entry point knows the topic (reconnect, task,
    // bot/messenger stop). Recover it from the owner-scoped operation row so
    // device cancellation is symmetric across every caller.
    let resolvedTopicId = topicId;
    if (!resolvedTopicId) {
      const operation = await this.agentOperationModel.findById(resolvedOperationId);
      resolvedTopicId = operation?.topicId ?? undefined;
    }

    // 2. Cancel a device-hosted hetero process if applicable.
    // Check topic.metadata.runningOperation for device + heteroType info seeded by execAgent.
    // This runs regardless of whether interruptOperation succeeds — the remote process
    // is independent of the local operation registry.
    if (resolvedTopicId) {
      const topic = await this.topicModel.findById(resolvedTopicId);
      const runningOp = (topic?.metadata as any)?.runningOperation as
        | {
            deviceId?: string;
            deviceUserId?: string;
            deviceWorkspaceId?: string;
            heteroType?: string;
            operationId?: string;
            childOperations?: Array<{
              deviceId?: string;
              deviceUserId?: string;
              deviceWorkspaceId?: string;
              heteroType?: string;
              operationId?: string;
            }>;
          }
        | undefined;
      const targetOperation =
        runningOp?.operationId === resolvedOperationId
          ? runningOp
          : runningOp?.childOperations?.find((child) => child.operationId === resolvedOperationId);

      if (
        targetOperation?.deviceId &&
        targetOperation.heteroType &&
        (isRemoteHeterogeneousType(targetOperation.heteroType) ||
          isLocalHeterogeneousType(targetOperation.heteroType))
      ) {
        const taskId = targetOperation.operationId ?? resolvedOperationId;
        log(
          'interruptTask: cancelling device hetero process heteroType=%s deviceId=%s taskId=%s',
          targetOperation.heteroType,
          targetOperation.deviceId,
          taskId,
        );
        const cancelWorkspaceId =
          targetOperation.deviceWorkspaceId ??
          (await this.resolveDeviceWorkspaceId(targetOperation.deviceId));
        const cancelResult = await deviceGateway.executeToolCall(
          {
            deviceId: targetOperation.deviceId,
            userId: targetOperation.deviceUserId ?? this.userId,
            workspaceId: cancelWorkspaceId,
          },
          {
            apiName: 'cancelHeteroTask',
            arguments: JSON.stringify({ signal: 'SIGINT', taskId }),
            identifier: 'cancelHeteroTask',
          },
          // The device first gives the wrapper/native CLI 2s to stop
          // cooperatively, then escalates and drains its terminal callback.
          10_000,
        );

        if (isLocalHeterogeneousType(targetOperation.heteroType)) {
          deviceCancellationConfirmed =
            cancelResult.success &&
            isRecord(cancelResult.state) &&
            cancelResult.state.exited === true;
        }

        if (!cancelResult.success || deviceCancellationConfirmed === false) {
          log(
            'interruptTask: device cancellation unconfirmed taskId=%s success=%s state=%O error=%s',
            taskId,
            cancelResult.success,
            cancelResult.state,
            cancelResult.error,
          );
        }
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
        deviceCancellationConfirmed,
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
      deviceCancellationConfirmed,
      operationId: resolvedOperationId,
      success: true,
      threadId: thread?.id,
    };
  }

  /**
   * Stop a run that is parked waiting for tool approval: settle the pending
   * tool rows and terminate the operation, WITHOUT executing anything and
   * without continuing the model.
   *
   * This is the "from this step on, don't go any further" action. It is not the
   * same as rejecting a tool — a rejection resumes the model so it can respond
   * to the refusal, whereas stopping ends the turn outright.
   *
   * Why it can't reuse the ordinary cancel path: when the runtime parks it
   * emits a stream-terminal `waiting_for_human`, so the client marks its own
   * operation `completed` and prunes it ~30s later. The pending tool rows retain
   * the authoritative operation and sealed-batch identity; callers must send
   * that exact correlation and this service verifies it against both the
   * operation record and every batch member before claiming anything.
   *
   * The tool rows are settled IN PLACE (the approval pause already created one
   * row per pending call). Inserting fresh aborted rows would duplicate every
   * tool in the turn and leave the originals `pending`, which is exactly what
   * keeps the approval cards on screen after a stop.
   */
  async stopPendingApproval(params: {
    approvalResolutionRequestId?: string;
    batchId: string;
    operationId: string;
    toolMessageIds: string[];
    topicId: string;
  }): Promise<{
    operationId: string;
    settledToolMessageIds: string[];
    success: boolean;
  }> {
    const { approvalResolutionRequestId, batchId, operationId, toolMessageIds, topicId } = params;

    const operation = await this.agentOperationModel.findById(operationId);
    if (
      !operation ||
      operation.topicId !== topicId ||
      (operation.status !== 'waiting_for_human' && operation.status !== 'interrupted')
    ) {
      throw new Error('stopPendingApproval: operation is not the parked owner of this topic');
    }

    // Validate identity and complete sealed-batch membership before the atomic
    // claim. The caller cannot stop a hand-picked subset or a stale batch from
    // another parked operation.
    const targets: { alreadyClaimed: boolean; id: string }[] = [];
    for (const toolMessageId of toolMessageIds) {
      const message = await this.messageModel.findById(toolMessageId);
      if (!message)
        throw new Error(`stopPendingApproval: tool message not found: ${toolMessageId}`);
      if (message.role !== 'tool') {
        throw new Error(
          `stopPendingApproval.toolMessageIds must point at role='tool' messages, got role='${message.role}'`,
        );
      }
      if (message.topicId !== topicId) {
        throw new Error('stopPendingApproval: topicId does not match the target tool message');
      }
      const plugin = await this.messageModel.findMessagePlugin(toolMessageId);
      const intervention = plugin?.intervention;
      if (
        !intervention ||
        intervention.operationId !== operationId ||
        intervention.batchId !== batchId
      ) {
        throw new Error('stopPendingApproval: target is not in the requested batch');
      }
      const alreadyClaimed =
        intervention.status === 'aborted' &&
        Boolean(approvalResolutionRequestId) &&
        intervention.resolutionRequestId === approvalResolutionRequestId;
      if (intervention.status !== 'pending' && !alreadyClaimed) {
        throw new HumanApprovalAlreadyResolvedError(toolMessageId);
      }
      targets.push({ alreadyClaimed, id: toolMessageId });
    }

    const fullBatchIds = (await this.messageModel.listMessagePluginsByTopic(topicId))
      .filter(
        (plugin) =>
          plugin.intervention?.operationId === operationId &&
          plugin.intervention?.batchId === batchId,
      )
      .map(({ id }) => id)
      .sort();
    const requestedIds = targets.map(({ id }) => id).sort();
    if (
      fullBatchIds.length !== requestedIds.length ||
      fullBatchIds.some((id, index) => id !== requestedIds[index])
    ) {
      throw new Error('stopPendingApproval: targets must cover the complete sealed batch');
    }

    const alreadyClaimedCount = targets.filter(({ alreadyClaimed }) => alreadyClaimed).length;
    if (alreadyClaimedCount !== 0 && alreadyClaimedCount !== targets.length) {
      throw new Error('stopPendingApproval: batch has a partial resolution claim');
    }
    if (operation.status === 'interrupted' && alreadyClaimedCount !== targets.length) {
      throw new Error('stopPendingApproval: interrupted operation has unsettled batch members');
    }

    if (alreadyClaimedCount === 0) {
      await this.messageModel.resolveHumanApproval(
        targets.map((target) => ({
          content: STOPPED_TOOL_CONTENT,
          id: target.id,
          intervention: {
            ...(approvalResolutionRequestId && {
              resolutionRequestId: approvalResolutionRequestId,
            }),
            status: 'aborted',
          },
        })),
      );
    }

    if (operation.status !== 'interrupted') {
      await this.agentRuntimeService.interruptOperation(operationId);
      await this.agentOperationModel.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'interrupted',
        status: 'interrupted',
      });
    }

    log(
      'stopPendingApproval: settled %d tool message(s), retired operation %s',
      targets.length,
      operationId,
    );

    return {
      operationId,
      settledToolMessageIds: targets.map((t) => t.id),
      success: true,
    };
  }

  /**
   * Retire the operation segment that parked on an approval after its
   * replacement continuation has been scheduled. The Redis state is stopped
   * first; the durable row then converges waiting_for_human -> done. Repeating
   * this call is safe, including after Cloud supersession won the race.
   */
  async retirePendingApprovalOperation(operationId: string): Promise<void> {
    await this.agentRuntimeService.interruptOperation(operationId);

    const operation = await this.agentOperationModel.findById(operationId);
    if (!operation) {
      throw new Error(`retirePendingApprovalOperation: operation not found: ${operationId}`);
    }
    if (operation.status === 'done' || operation.status === 'interrupted') return;
    if (operation.status !== 'waiting_for_human') {
      throw new Error(
        `retirePendingApprovalOperation: expected waiting_for_human, got ${operation.status}`,
      );
    }

    const completed = await this.agentOperationModel.recordCompletion(operationId, {
      completedAt: new Date(),
      completionReason: 'done',
      status: 'done',
    });
    if (!completed) {
      const latest = await this.agentOperationModel.findById(operationId);
      if (latest?.status !== 'done' && latest?.status !== 'interrupted') {
        throw new Error(`retirePendingApprovalOperation: failed to settle ${operationId}`);
      }
    }
  }

  /** Owner-scoped runtime state used by the v2 router's crash-safe retry probe. */
  async loadInterventionContinuationState(operationId: string): Promise<AgentState | null> {
    return this.agentRuntimeService.loadInterventionContinuationState(operationId);
  }

  /** Requeue an idle deterministic continuation without rebuilding its assistant turn. */
  async ensureInterventionContinuationStarted(
    operationId: string,
  ): Promise<'already_started' | 'missing' | 'scheduled'> {
    return this.agentRuntimeService.ensureInterventionContinuationStarted(operationId);
  }

  /**
   * Repair the topic reconnect marker and release the exact start reservation
   * after a durable queue ACK. A foreign newer running operation fails closed.
   */
  async repairInterventionContinuationTopicAnchor(params: {
    assistantMessageId: string;
    continuationOperationId: string;
    resolutionRequestId: string;
    scope?: string | null;
    sourceOperationId: string;
    sourceToolMessageIds: string[];
    threadId?: string | null;
    topicId: string;
  }): Promise<void> {
    const operation = await this.agentOperationModel.findById(params.continuationOperationId);
    const expectedProvenance = {
      resolutionRequestId: params.resolutionRequestId,
      sourceOperationId: params.sourceOperationId,
      sourceToolMessageIds: [...params.sourceToolMessageIds].sort(),
    };
    const assistant = await this.messageModel.findById(params.assistantMessageId);
    const dispatchMarker = operation?.metadata?.agentInterventionDispatch as
      | {
          deduplicationId?: unknown;
          resolutionRequestId?: unknown;
          state?: unknown;
        }
      | undefined;
    const expectedDeduplicationId = deriveAgentInterventionQueueDeduplicationId(
      params.continuationOperationId,
      0,
    );
    if (
      !operation ||
      operation.topicId !== params.topicId ||
      !matchesAgentInterventionContinuationProvenance(
        operation.metadata?.agentInterventionContinuation,
        expectedProvenance,
      ) ||
      dispatchMarker?.state !== 'scheduled' ||
      dispatchMarker.resolutionRequestId !== params.resolutionRequestId ||
      dispatchMarker.deduplicationId !== expectedDeduplicationId ||
      assistant?.role !== 'assistant' ||
      assistant.topicId !== params.topicId
    ) {
      throw new Error('Intervention continuation topic repair provenance conflict');
    }

    // Thread continuations use the deterministic topic reservation only as a
    // short single-initializer fence. They never own the topic's main
    // runningOperation anchor, so ACK recovery must release exactly their
    // reservation without promoting the thread into the main conversation
    // spine. A foreign reservation is intentionally left untouched.
    if (params.threadId) {
      const released = await this.topicModel.releaseTaskCallbackReservation(
        params.topicId,
        params.continuationOperationId,
      );
      if (released === 'foreign') {
        throw new Error('Intervention continuation topic repair found a foreign reservation');
      }
      return;
    }

    const state = await this.agentRuntimeService.loadInterventionContinuationState(
      params.continuationOperationId,
    );
    const runtimeTerminal =
      state?.status === 'done' || state?.status === 'error' || state?.status === 'interrupted';
    const durableTerminal =
      operation.status === 'done' ||
      operation.status === 'error' ||
      operation.status === 'interrupted' ||
      operation.status === 'abandoned';
    const result = await this.topicModel.repairAgentInterventionContinuation({
      active: !runtimeTerminal && !durableTerminal,
      assistantMessageId: params.assistantMessageId,
      continuationOperationId: params.continuationOperationId,
      reservationId: params.continuationOperationId,
      scope: params.scope,
      sourceOperationId: params.sourceOperationId,
      startedAt: operation.startedAt?.toISOString() ?? new Date().toISOString(),
      threadId: params.threadId,
      topicId: params.topicId,
    });
    if (result === 'conflict') {
      throw new Error('Intervention continuation topic repair found a foreign running operation');
    }
  }
}
