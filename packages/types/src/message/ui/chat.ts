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

export interface AssistantContentBlock {
  content: string;
  error?: ChatMessageError | null;
  fileList?: ChatFileItem[];
  id: string;
  imageList?: ChatImageItem[];
  metadata?: Record<string, any>;
  performance?: ModelPerformance;
  reasoning?: ModelReasoning;
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
   * target member ID for DM messages in group chat
   */
  targetId?: string | null;
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
