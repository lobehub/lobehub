/**
 * Context Tree Types
 *
 * Tree structure for understanding conversation flow and navigation.
 * Used for complex operations like branch switching and context understanding.
 */

/**
 * Base interface for all display nodes
 */
interface BaseNode {
  /** Unique identifier for this node */
  id: string;
  /** Type discriminator */
  type:
    | 'message'
    | 'assistantGroup'
    | 'compare'
    | 'branch'
    | 'agentCouncil'
    | 'tasks'
    | 'compressedGroup'
    | 'compareGroup';
}

/**
 * Basic message node - leaf node representing a single message
 */
export interface MessageNode extends BaseNode {
  /** Tool message IDs (for assistant messages with tool calls) */
  tools?: string[];
  type: 'message';
}

/**
 * Assistant group node - aggregates an assistant message with its tool calls
 */
export interface AssistantGroupNode extends BaseNode {
  /** Child nodes (assistant and tool messages) */
  children: ContextNode[];
  type: 'assistantGroup';
}

/**
 * Compare node - renders multiple parallel outputs side by side
 */
export interface CompareNode extends BaseNode {
  /** ID of the active column that enters LLM context */
  activeColumnId?: string;
  /** Each column represents a parallel output tree */
  columns: ContextNode[][];
  /** The message that triggered the comparison */
  messageId: string;
  type: 'compare';
}

/**
 * Branch node - represents multiple alternate conversation paths
 */
export interface BranchNode extends BaseNode {
  /** Index of the currently active branch */
  activeBranchIndex: number;
  /** Each branch is a separate conversation tree */
  branches: ContextNode[][];
  /** The parent message that has multiple branches */
  parentMessageId: string;
  type: 'branch';
}

/**
 * Agent Council node - renders multiple agent responses in parallel
 * Unlike CompareNode, all responses enter LLM context (no selection needed)
 */
export interface AgentCouncilNode extends BaseNode {
  /** Each member represents a single agent's response (simple ContextNode, not array) */
  members: ContextNode[];
  /** The message that triggered the council (typically a tool message) */
  messageId: string;
  type: 'agentCouncil';
}

/**
 * Tasks node - aggregates multiple async task messages with the same parentId
 * Created when multiple role='task' messages share the same parent (typically a tool message)
 */
export interface TasksNode extends BaseNode {
  /** Child task message nodes */
  children: ContextNode[];
  /** The parent message ID that triggered the tasks (typically a tool message) */
  messageId: string;
  type: 'tasks';
}

/**
 * Pinned message within a compression group
 */
export interface PinnedMessage {
  content: string | null;
  createdAt: Date | string;
  id: string;
  model: string | null;
  provider: string | null;
  role: string;
}

/**
 * Compressed Group node - represents compressed/summarized messages
 * Messages marked as compressed are hidden, and a summary is shown instead.
 * Pinned messages (favorite=true) within the compression group are preserved.
 */
export interface CompressedGroupNode extends BaseNode {
  /** Summary content of the compressed messages */
  content: string | null;
  /** Messages marked as favorite/pinned within this compression group */
  pinnedMessages: PinnedMessage[];
  type: 'compressedGroup';
}

/**
 * Child message within a compare group (parallel responses)
 */
export interface CompareGroupChild {
  content: string | null;
  createdAt: Date | string;
  id: string;
  model: string | null;
  provider: string | null;
  role: string;
}

/**
 * Compare Group node - represents parallel model responses
 * Multiple models respond to the same user message in parallel.
 * Different from CompareNode which is built from metadata.compare flag.
 */
export interface CompareGroupNode extends BaseNode {
  /** Parallel responses from different models */
  children: CompareGroupChild[];
  type: 'compareGroup';
}

/**
 * Union type of all display nodes
 */
export type ContextNode =
  | MessageNode
  | AssistantGroupNode
  | CompareNode
  | BranchNode
  | AgentCouncilNode
  | TasksNode
  | CompressedGroupNode
  | CompareGroupNode;
