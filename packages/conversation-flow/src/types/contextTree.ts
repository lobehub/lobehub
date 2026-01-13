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
  type: 'message' | 'assistantGroup' | 'compare' | 'branch' | 'agentCouncil' | 'tasks';
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
 * Union type of all display nodes
 */
export type ContextNode =
  | MessageNode
  | AssistantGroupNode
  | CompareNode
  | BranchNode
  | AgentCouncilNode
  | TasksNode;
