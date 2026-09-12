import type {
  ActivatedStepSkill,
  ActivatedStepTool,
  AgentGroupConfig,
  BotPlatformContext,
  DiscordContext,
  EvalContext,
  OperationToolSet,
  ProjectInstructionFile,
  ToolExecutor,
  ToolSource,
  UserMemoryConfig,
} from '@lobechat/context-engine';
import type {
  ChatToolPayload,
  ExpertiseContextSnapshot,
  LobeAgentChatConfig,
  LobeAgentConfig,
  SecurityBlacklistConfig,
  UserInterventionConfig,
} from '@lobechat/types';

import type { Cost, CostLimit, Usage } from './usage';

/**
 * Search route resolved once before the run starts. Declared here rather than
 * imported so the runtime package does not depend on the model catalog;
 * structurally identical to the resolver output in `model-bank`.
 */
export interface SearchDecisionSnapshot {
  enabledSearch: boolean;
  isModelHasBuiltinSearch: boolean;
  isProviderHasBuiltinSearch: boolean;
  useApplicationBuiltinSearchTool: boolean;
  useModelSearch: boolean;
}

/**
 * The agent definition as the host resolved it for this run.
 *
 * `Partial` because hosts snapshot only what the run needs; the identity
 * fields and the sub-agent override are run-level facts the host stamps on
 * top of the stored agent config.
 */
export interface RunAgentSnapshot extends Partial<LobeAgentConfig> {
  /** Agent-row description; surfaces in tracing spans and skill placeholders. */
  description?: string | null;
  id?: string;
  slug?: string | null;
  /**
   * Raw callSubAgent chatConfig override, stamped alongside the merged
   * chatConfig so explicit sub-agent reasoning choices can be re-applied over
   * the user's model-instance defaults.
   */
  subAgentChatConfigOverride?: Partial<LobeAgentChatConfig>;
}

/**
 * What the model is told about the run's world.
 *
 * Frozen when the operation is created: every field is a fact the host
 * resolved once (agent definition, group roster, project instructions, user
 * memory, channel facts) and the context engine only reads it back on each
 * step to assemble the system message. Nothing in here changes while the run
 * executes — a run that needs a different world is a different operation.
 */
export interface AgentWorldSnapshot {
  /** Agent definition snapshot: systemRole, chatConfig, agencyConfig … */
  agent?: RunAgentSnapshot;
  /** Channel-specific facts the model should know (bot platform, Discord …). */
  channel?: {
    botPlatform?: BotPlatformContext;
    discord?: DiscordContext;
  };
  /** Borrowed-connector attribution rendered into the system message. */
  connectorOwnershipNote?: string;
  /** Evaluation prompt data for eval runs. */
  eval?: EvalContext;
  /** Multi-agent group roster (or bot-conversation fallback). */
  group?: AgentGroupConfig;
  /** Root instruction files of the bound project. */
  projectInstructions?: ProjectInstructionFile[];
  /** Search route resolved before the run started. */
  searchDecision?: SearchDecisionSnapshot;
  /** User memory the model may recall from. */
  userMemory?: UserMemoryConfig;
  /** IANA timezone used to render "now" for the model. */
  userTimezone?: string;
}

/**
 * Execution facts that are bound late.
 *
 * Unlike {@link AgentWorldSnapshot} and the execution plan, this is the one
 * business slot the runtime host may rewrite at a step boundary: a device
 * that was unrouted at creation can be bound once a tool result names it
 * (`computeDeviceContext`), and the bound device's system info feeds both
 * prompt placeholders and tool cwd resolution.
 */
export interface AgentRunBinding {
  /**
   * Device routed for this run. `id` stays absent until a device is bound;
   * `systemInfo` may already carry a working directory for runs whose cwd was
   * resolved from a persisted device row.
   */
  device?: {
    id?: string;
    platform?: string;
    systemInfo?: Record<string, string>;
  };
}

/**
 * Agent's serializable state.
 * This is the "passport" that can be persisted and transferred.
 */
export interface AgentState {
  /** Cumulative record of skills activated at step level */
  activatedStepSkills?: ActivatedStepSkill[];
  /** Cumulative record of tools activated at step level */
  activatedStepTools?: ActivatedStepTool[];
  // --- Late-bound execution facts ---
  /**
   * Execution facts bound at a step boundary (device routing). The only
   * business slot the host may write after creation.
   */
  binding?: AgentRunBinding;

  /**
   * Current calculated cost for this session.
   * Updated after each billable operation.
   */
  cost: Cost;
  /**
   * Optional cost limits configuration.
   * If set, execution will stop when limits are exceeded.
   */
  costLimit?: CostLimit;
  // --- Metadata ---
  createdAt: string;
  /** Whether ContextEngine may inject the operation expertise snapshot. */
  enableExpertise?: boolean;
  error?: any;
  /** Immutable expertise snapshot resolved once when this operation starts. */
  expertise?: ExpertiseContextSnapshot;
  /**
   * When true, the agent is in force-finish mode (maxSteps exceeded).
   * Tools are allowed to complete, but the next LLM call will have tools stripped
   * and a summary prompt injected to produce a final text response.
   */
  forceFinish?: boolean;
  // --- Interruption Handling ---
  /**
   * When status is 'interrupted', this stores the interruption context
   * for potential resumption or cleanup.
   */
  interruption?: {
    /** Reason for interruption */
    reason: string;
    /** Timestamp when interruption occurred */
    interruptedAt: string;
    /** The instruction that was being executed when interrupted */
    interruptedInstruction?: any;
    /** Whether the interruption can be resumed */
    canResume: boolean;
  };
  lastModified: string;

  /**
   * Optional maximum number of steps allowed.
   * If set, execution will stop with error when exceeded.
   */
  maxSteps?: number;

  // --- Core Context ---
  messages: any[];

  /**
   * Un-converged run context. Keys that have a business home live in the
   * typed slots (`world`, `binding`, …); anything left here is either host
   * plumbing the runtime does not interpret or context that has not been
   * placed yet. `normalizeAgentState` lifts legacy keys out on load.
   */
  metadata?: Record<string, any>;

  /**
   * Model runtime configuration
   * Used as fallback when call_llm instruction doesn't specify model/provider
   */
  modelRuntimeConfig?: {
    /**
     * Immutable operation snapshot shared by tool discovery and context processing.
     * Optional for operations created before this snapshot was introduced.
     */
    mediaCapabilities?: {
      audio?: boolean;
      video?: boolean;
      vision?: boolean;
    };
    model: string;
    provider: string;
    /**
     * Compression model configuration
     * Used for context compression tasks
     */
    compressionModel?: {
      model: string;
      provider: string;
    };
  };
  operationId: string;

  /** Operation-level tool set snapshot (immutable after creation) */
  operationToolSet?: OperationToolSet;
  pendingApprovalBatch?: {
    assistantMessageId: string;
    id: string;
    sealed: true;
    stepIndex: number;
    /**
     * Previous durable batch whose still-pending rows were rebound into this
     * parked operation. The server notification adapter turns this into an
     * atomic generic-store supersession; keeping only authoritative source
     * identities here avoids coupling the runtime package to ActivityKit or a
     * Cloud database model.
     */
    supersedes?: {
      batchId: string;
      operationId: string;
      toolCallIds: string[];
    };
  };
  // --- HIL ---
  /**
   * Assistant placeholder seeded for a resume that starts by executing a tool
   * (e.g. a human-approved / auto-approved tool such as the tools activator).
   * The first `call_llm` after that tool consumes this id so its output reuses
   * the placeholder instead of creating a new message and orphaning the seed.
   * Cleared once consumed.
   */
  pendingAssistantMessageId?: string;

  pendingHumanPrompt?: { metadata?: Record<string, unknown>; prompt: string };
  pendingHumanSelect?: {
    metadata?: Record<string, unknown>;
    multi?: boolean;
    options: Array<{ label: string; value: string }>;
    prompt?: string;
  };
  /** toolCallId -> durable pending tool-message id for the current sealed batch. */
  pendingToolMessageIds?: Record<string, string>;
  /**
   * When status is 'waiting_for_human', this stores pending requests
   * for human-in-the-loop operations.
   */
  pendingToolsCalling?: ChatToolPayload[];
  /**
   * Security blacklist configuration
   * These rules will ALWAYS block execution and require human intervention,
   * regardless of user settings (even in auto-run mode).
   * If not provided, DEFAULT_SECURITY_BLACKLIST will be used.
   */
  securityBlacklist?: SecurityBlacklistConfig;
  // --- State Machine ---
  status:
    | 'idle'
    | 'running'
    | 'waiting_for_human'
    | 'waiting_for_async_tool'
    | 'done'
    | 'error'
    | 'interrupted';

  // --- Execution Tracking ---
  /**
   * Number of execution steps in this session.
   * Incremented on each runtime.step() call.
   */
  stepCount: number;

  systemRole?: string;
  /**
   * Consecutive LLM turns that emitted the same normalized tool calls.
   * Only signatures present in the latest tool-calling turn are retained.
   */
  toolCallRepeatGuard?: {
    counts: Record<string, number>;
  };

  /** Tool executor map for routing tool execution between server and client */
  toolExecutorMap?: Record<string, ToolExecutor>;

  toolManifestMap: Record<string, any>;

  tools?: any[];

  /** Tool source map for routing tool execution to correct handler */
  toolSourceMap?: Record<string, ToolSource>;

  /**
   * How many times this operation has answered unresolvable tool calls with a
   * rejected tool result. Operation-scoped on purpose: the same rejection rows
   * are also readable from the message history, but that history is rehydrated
   * from the DB on every step and carries earlier operations' rejections, so
   * counting rows there would spend a new operation's budget before it starts.
   */
  unresolvedToolFeedbackRounds?: number;
  // --- Usage and Cost Tracking ---
  /**
   * Accumulated usage statistics for this session.
   * Tracks tokens, API calls, tool usage, etc.
   */
  usage: Usage;

  /**
   * User's global intervention configuration
   * Controls how tools requiring approval are handled
   */
  userInterventionConfig?: UserInterventionConfig;

  // --- World snapshot ---
  /**
   * What the model is told about the run's world. Frozen at creation and
   * read by the context engine on every step.
   */
  world?: AgentWorldSnapshot;
}

/**
 * OpenAI Tool Call
 */
export interface ToolsCalling {
  function: {
    arguments: string;
    name: string; // A JSON string of arguments
  };
  id: string;
  /**
   * Gemini 3.x thought signature, captured from `functionCall.thoughtSignature` in the
   * streaming response. Must be round-tripped back in subsequent requests or Gemini will
   * 400 with a misleading "ordering" error. Optional; only set for Gemini 3.x tool calls.
   */
  thoughtSignature?: string;
  type: 'function';
}

/**
 * A registry for tools, mapping tool names to their implementation.
 */
export type ToolRegistry = Record<string, (args: any) => Promise<any>>;
