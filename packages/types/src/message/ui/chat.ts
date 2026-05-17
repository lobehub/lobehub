import type { GroundingSearch } from '../../search';
import type { ThreadStatus } from '../../topic/thread';
import type {
  ChatImageItem,
  ChatMessageError,
  MessageMetadata,
  ModelPerformance,
  ModelReasoning,
  ModelUsage,
} from '../common';
import type {
  ChatPluginPayload,
  ChatToolPayload,
  ChatToolPayloadWithResult,
  ToolIntervention,
} from '../common/tools';
import type { ChatMessageExtra } from './extra';
import type { ChatFileChunk } from './rag';
import type { ChatVideoItem } from './video';

export type UIMessageRoleType =
  | 'user'
  | 'system'
  | 'assistant'
  | 'tool'
  | 'task'
  | 'tasks'
  | 'groupTasks'
  | 'supervisor'
  | 'assistantGroup'
  | 'agentCouncil'
  | 'compressedGroup'
  | 'compareGroup';

export interface ChatFileItem {
  content?: string;
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

/**
 * A subagent execution embedded inline in the parent assistant block.
 *
 * Used for Claude Code's `Task` tool (and equivalent subagent-spawning tools):
 * the LLM emits a Task tool_use, the executor creates a Thread to run the
 * subagent, and the rendered block shows a folded header + (on expand) the
 * Thread's child messages — instead of producing a separate `role: 'task'`
 * ChatItem bubble.
 *
 * Derived view, not persisted: the MessageTransformer reconstructs
 * `block.tasks[]` by joining Threads (`threads.sourceMessageId = msg.id`,
 * matched by `metadata.sourceToolCallId === tool_use.id`) onto the parent
 * message's tool_use entries.
 */
export interface TaskBlock {
  /** Execution duration in milliseconds (`Thread.metadata.duration`) */
  duration?: number;
  /** Error details when subagent failed (`Thread.metadata.error`) */
  error?: any;
  /** Equals the parent tool_use id that spawned this subagent */
  id: string;
  /** Thread execution status */
  status?: ThreadStatus;
  /** Subagent type, e.g. CC's `subagent_type` input (Explore, Plan, ...) */
  subagentType?: string;
  threadId: string;
  /**
   * Short summary rendered in the folded header — sourced from `Thread.title`
   * (for CC Task spawns, the executor persists the tool_use's `description`
   * input there at create time, so there is no separate `description` field
   * on this block).
   */
  title?: string;
  /** Total cost in dollars */
  totalCost?: number;
  /** Total tokens consumed */
  totalTokens?: number;
  /** Total tool calls made by the subagent */
  totalToolCalls?: number;
}

export interface AssistantContentBlock {
  content: string;
  error?: ChatMessageError | null;
  fileList?: ChatFileItem[];
  id: string;
  imageList?: ChatImageItem[];
  metadata?: Record<string, any>;
  performance?: ModelPerformance;
  reasoning?: ModelReasoning;
  /**
   * Subagent executions embedded inline. Disambiguated from regular tools
   * because each task carries a Thread reference and renders as a folded
   * panel (showing the Thread's child messages on expand) instead of a
   * standalone tool result.
   */
  tasks?: TaskBlock[];
  tools?: ChatToolPayloadWithResult[];
  usage?: ModelUsage;
}
interface UIMessageBranch {
  /** Index of the active branch (0-based) */
  activeBranchIndex: number;
  /** Total number of branches */
  count: number;
}

/**
 * Snapshot of a single toolless assistant callback inside a
 * {@link UISignalCallbacksBlock}. The snapshot is denormalized at
 * FlatListBuilder time so the renderer doesn't have to round-trip
 * through the messages map.
 */
export interface UISignalCallback {
  content: string;
  id: string;
  model?: string | null;
  provider?: string | null;
  /** Nth push from the same source (1-based, matches metadata.signal.sequence). */
  sequence?: number;
}

/**
 * Group of callback turns attached to one source tool, denormalized
 * onto a virtual `assistantGroup` message by FlatListBuilder. One
 * block per source tool — multiple callback-firing tools in the same
 * group produce multiple blocks.
 */
export interface UISignalCallbacksBlock {
  callbacks: UISignalCallback[];
  sourceToolCallId: string;
  sourceToolMessageId: string;
  sourceToolName: string;
}

/**
 * Task execution details for role='task' messages
 * Retrieved from the associated Thread via sourceMessageId
 */
export interface TaskDetail {
  /** Whether this task runs in client mode (local execution) */
  clientMode?: boolean;
  /** Task completion time (ISO string) */
  completedAt?: string;
  /** Execution duration in milliseconds */
  duration?: number;
  /** Error message if task failed */
  error?: Record<string, any>;
  /** Task start time (ISO string) */
  startedAt?: string;
  /** Task status */
  status: ThreadStatus;
  /** Thread ID for navigation */
  threadId: string;
  /** Thread title/summary */
  title?: string;
  /** Total cost in dollars */
  totalCost?: number;
  /** Total messages created during execution */
  totalMessages?: number;
  /** Total execution steps */
  totalSteps?: number;
  /** Total tokens consumed */
  totalTokens?: number;
  /** Total tool calls made */
  totalToolCalls?: number;
}

export interface UIChatMessage {
  // Group chat fields (alphabetically before other fields)
  agentId?: string | 'supervisor';
  /**
   * Branch information for user messages with multiple children
   */
  branch?: UIMessageBranch;
  /**
   * children messages for grouped display
   * Used to group tool messages under their parent assistant message
   */
  children?: AssistantContentBlock[];
  chunksList?: ChatFileChunk[];
  /**
   * All messages within a compression group (role: 'compressedGroup')
   * Used for rendering expanded view with conversation-flow parsing
   */
  compressedMessages?: UIChatMessage[];
  content: string;
  createdAt: number;
  /** Lexical editor JSON state for rich text rendering */
  editorData?: Record<string, any> | null;
  error?: ChatMessageError | null;
  // Extended fields
  extra?: ChatMessageExtra;
  fileList?: ChatFileItem[];
  /**
   * this is a deprecated field, only use in client db
   * and should be remove after migrate to pglite
   * this field is replaced by fileList and imageList
   * @deprecated
   */
  files?: string[];
  groupId?: string;
  id: string;
  imageList?: ChatImageItem[];
  members?: UIChatMessage[];
  metadata?: MessageMetadata | null;
  model?: string | null;
  /**
   * observation id
   */
  observationId?: string;
  /**
   * parent message id
   */
  parentId?: string;
  /**
   * Performance metrics (tps, ttft, duration, latency)
   * Aggregated from all children in group messages
   */
  performance?: ModelPerformance;
  /**
   * Pinned messages within a compression group (role: 'compressedGroup')
   * Messages marked as favorite=true are included here
   */
  pinnedMessages?: {
    content: string | null;
    createdAt: Date;
    id: string;
    model: string | null;
    provider: string | null;
    role: string;
  }[];
  plugin?: ChatPluginPayload;
  pluginError?: any;
  pluginIntervention?: ToolIntervention;
  pluginState?: any;
  provider?: string | null;
  /**
   * quoted other message's id
   */
  quotaId?: string;
  ragQuery?: string | null;
  ragQueryId?: string | null;
  ragRawQuery?: string | null;
  reasoning?: ModelReasoning | null;
  /**
   * message role type
   */
  role: UIMessageRoleType;
  search?: GroundingSearch | null;
  sessionId?: string;
  /**
   * External-signal callback blocks (LOBE-8998). Set on virtual
   * assistantGroup messages built by FlatListBuilder when the chain
   * contains toolless assistants triggered by repeated tool_results
   * (Monitor stdout push pattern). Rendered as `<SignalCallbacks>`
   * blocks inside the AssistantGroup, separate from the main chain.
   *
   * Each entry corresponds to one source tool; multiple source tools
   * in the same group produce multiple entries.
   */
  signalCallbacks?: UISignalCallbacksBlock[];
  /**
   * target member ID for DM messages in group chat
   */
  targetId?: string | null;
  /**
   * Post-task summary blocks (LOBE-8998). Set on virtual assistantGroup
   * messages by FlatListBuilder when the chain contains toolless
   * assistants tagged with `signal.type === 'task-completion'` — the
   * final-summary turn the LLM emits after CC delivers
   * `system task_notification` for a long-running tool (Monitor, etc.).
   *
   * Rendered after `<SignalCallbacks>` so the natural narrative inside
   * the same AssistantGroup reads: initial reply → callback accordion →
   * summary. Multiple entries are possible (rare) if several tools
   * completed within one LLM run.
   */
  taskCompletions?: AssistantContentBlock[];
  /**
   * Task execution details for role='task' messages
   * Retrieved from the associated Thread via sourceMessageId
   */
  taskDetail?: TaskDetail;
  /**
   * Task messages for role='tasks' virtual message
   * Contains aggregated task messages with same parentId
   * Also used to store task execution messages (intermediate steps) from polling
   */
  tasks?: UIChatMessage[];
  threadId?: string | null;
  tool_call_id?: string;
  tools?: ChatToolPayload[];
  /**
   * Messages saved to topic
   */
  topicId?: string;
  /**
   * Observation trace ID
   */
  traceId?: string;
  updatedAt: number;
  /**
   * Token usage and cost metrics
   * Aggregated from all children in group messages
   */
  usage?: ModelUsage;
  videoList?: ChatVideoItem[];
}
