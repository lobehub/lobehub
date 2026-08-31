import type { BotPlatformContext } from '@lobechat/context-engine';
import type {
  ChatTopicBotContext,
  ExecAgentParams,
  LobeAgentChatConfig,
  RuntimeMentionedAgent,
  UserInterventionConfig,
  WorkingDirConfig,
  WorkspaceInitResult,
} from '@lobechat/types';

import type { EvalContext } from '@/server/modules/Mecha/ContextEngineering/types';
import type { AgentConfigWithId } from '@/server/services/agent';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import type { EvalRuntimeContext } from '@/server/services/agentRuntime/types';

import type { DeviceAccessReason } from './deviceAccessPolicy';
import type { AgentShareGate } from './shareGate';

/**
 * Resolved run state shared by the {@link AiAgentService.execAgent} pipeline
 * stages (`pipeline/*`). Built once inside `execAgent` after agent/topic/turn
 * setup, then handed to each extracted stage so the data every stage consumes
 * is explicit instead of riding on closure variables.
 *
 * `agentConfig` is intentionally the same MUTABLE object `execAgent` holds:
 * stages append to `systemRole` (connector ownership notes, project
 * instructions) and later steps — `createOperation` in particular — must see
 * those writes.
 */
export interface ExecRunContext {
  agentConfig: AgentConfigWithId;
  appContext?: InternalExecAgentParams['appContext'];
  /** Persisted assistant placeholder row id (spinner anchor / error sink). */
  assistantMessageId: string;
  canUseDevice: boolean;
  deviceAccessReason: DeviceAccessReason;
  /** Effective model for this run (topic-pinned model already applied). */
  model: string;
  parentMessageId?: string;
  /** Persistence-attribution agent id (Agent Signal marker aware). */
  persistAgentId: string;
  prompt: string;
  provider: string;
  /** The actual executing agent row id resolved from id/slug. */
  resolvedAgentId: string;
  /**
   * Shared-agent visitor gate for this run, mirrored from
   * {@link InternalExecAgentParams.shareGate} so every extracted pipeline stage
   * can enforce it without threading a separate argument. Undefined for every
   * ordinary (non-share) run.
   */
  shareGate?: AgentShareGate;
  /** Topic id — guaranteed to exist by the time pipeline stages run. */
  topicId: string;
  trigger?: string;
  /** User turn row id; undefined when the run starts from history (resume). */
  userMessageId?: string;
}

/**
 * Internal params for execAgent with step lifecycle callbacks
 * This extends the public ExecAgentParams with server-side only options
 */
export interface InternalExecAgentParams extends ExecAgentParams {
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
  /**
   * Shared-agent visitor gate. Set ONLY by the shareChat router after the
   * share access check — never client-passable. Restricts tools/memory/files at
   * operation-build time, denies device access, and scopes the visitor's rows.
   */
  shareGate?: AgentShareGate;
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
 * project path placeholder (and the tool cwd/scope downstream) without re-loading
 * the device + topic the scan already read.
 */
export interface ResolvedWorkspaceInit {
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
