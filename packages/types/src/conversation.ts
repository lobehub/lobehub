import type { IThreadType } from './topic/thread';

/**
 * Scope types for message map key generation
 * - main: Agent main conversation (default)
 * - thread: Agent thread conversation
 * - group: Group main conversation
 * - group_agent: Agent conversation within a group
 */
export type MessageMapScope =
  | 'main'
  | 'thread'
  | 'group'
  | 'group_agent'
  | 'group_agent_builder'
  | 'page'
  | 'agent_builder';

/**
 * Context for generating message map key with scope-driven architecture
 *
 * Key format: `{scope}_{scopeId}[_{topicId}][_{subTopicId}][_new]`
 *
 * @example
 * ```ts
 * // Main mode - new topic (default scope)
 * { scopeId: 'agt_xxx' } // => 'main_agt_xxx_new'
 *
 * // Main mode - existing topic
 * { scopeId: 'agt_xxx', topicId: 'tpc_yyy' } // => 'main_agt_xxx_tpc_yyy'
 *
 * // Thread mode - new thread
 * { scope: 'thread', scopeId: 'agt_xxx', topicId: 'tpc_yyy', isNew: true }
 * // => 'thread_agt_xxx_tpc_yyy_new'
 *
 * // Thread mode - existing thread
 * { scope: 'thread', scopeId: 'agt_xxx', topicId: 'tpc_yyy', subTopicId: 'thd_zzz' }
 * // => 'thread_agt_xxx_tpc_yyy_thd_zzz'
 *
 * // Group mode - new topic
 * { scope: 'group', scopeId: 'grp_xxx' } // => 'group_grp_xxx_new'
 *
 * // Group mode - existing topic
 * { scope: 'group', scopeId: 'grp_xxx', topicId: 'tpc_yyy' }
 * // => 'group_grp_xxx_tpc_yyy'
 *
 * // Group agent mode - existing agent topic
 * { scope: 'group_agent', scopeId: 'grp_xxx', topicId: 'tpc_yyy', subTopicId: 'tpc_zzz' }
 * // => 'group_agent_grp_xxx_tpc_yyy_tpc_zzz'
 * ```
 */
export interface MessageMapContext {
  /**
   * Whether this is a new/creating state (for optimistic updates)
   */
  isNew?: boolean;
  /**
   * Scope type for the message map
   * @default 'main'
   */
  scope?: MessageMapScope;
  /**
   * Scope identifier (agentId for main/thread, groupId for group/group_agent)
   */
  scopeId: string;
  /**
   * Sub topic identifier (threadId in agent mode, agent's topicId in group mode)
   */
  subTopicId?: string | null;
  /**
   * Topic identifier
   */
  topicId?: string | null;
}

/* eslint-disable typescript-sort-keys/interface */
/**
 * Context for identifying a conversation or message list
 * This is the standard type for all conversation-related context passing
 *
 * @example
 * ```ts
 * // Basic usage - main conversation
 * const context: ConversationContext = { agentId: 'agent-1' };
 *
 * // With topic
 * const topicContext: ConversationContext = {
 *   agentId: 'agent-1',
 *   topicId: 'topic-1'
 * };
 *
 * // With existing thread
 * const threadContext: ConversationContext = {
 *   agentId: 'agent-1',
 *   topicId: 'topic-1',
 *   threadId: 'thread-1'
 * };
 *
 * // Creating a new thread (isNew + scope: 'thread')
 * const newThreadContext: ConversationContext = {
 *   agentId: 'agent-1',
 *   topicId: 'topic-1',
 *   scope: 'thread',
 *   isNew: true,
 *   sourceMessageId: 'msg-1',
 *   threadType: ThreadType.Standalone,
 * };
 *
 * // Group conversation
 * const groupContext: ConversationContext = {
 *   agentId: 'agent-1',
 *   groupId: 'group-1',
 *   topicId: 'topic-1',
 *   scope: 'group',
 * };
 * ```
 */
export interface ConversationContext {
  agentId: string;
  /**
   * Group ID for group conversations
   * Used when scope is 'group' or 'group_agent'
   */
  groupId?: string;
  /**
   * Whether this is creating a new conversation (new topic or new thread)
   * Used for optimistic updates
   */
  isNew?: boolean;
  /**
   * Whether the current agent is the Supervisor in group orchestration
   * - Used to mark assistant messages with metadata.isSupervisor
   * - conversation-flow will transform role to 'supervisor' for UI rendering
   * - context-engine will restore role back to 'assistant' for model
   */
  isSupervisor?: boolean;
  /**
   * Scope type for the conversation
   * - 'main': Agent main conversation (default)
   * - 'thread': Agent thread conversation
   * - 'group': Group main conversation
   * - 'group_agent': Agent conversation within a group
   * @default 'main' (auto-detected based on threadId)
   */
  scope?: MessageMapScope;
  /**
   * @deprecated Use agentId for agent sessions. This field is kept for backward compatibility.
   */
  sessionId?: string;
  /**
   * Source message ID that the thread is branched from
   * Only used when creating a new thread (isNew=true, scope='thread')
   */
  sourceMessageId?: string;
  /**
   * Sub Agent ID for group orchestration scenarios
   * - Used to get Agent config (model, provider, plugins) instead of agentId
   * - Used to set message.agentId (mark message source)
   * - Falls back to agentId if not set
   *
   * @example
   * ```ts
   * // Supervisor executes: no subAgentId needed
   * { agentId: 'supervisor', groupId: 'group-1', scope: 'group' }
   *
   * // Agent speaks in group: use subAgentId for agent config
   * { agentId: 'supervisor', subAgentId: 'agent-1', groupId: 'group-1', scope: 'group' }
   * ```
   */
  subAgentId?: string;
  /**
   * Thread ID (takes highest priority if present)
   * When present, scope is auto-detected as 'thread'
   */
  threadId?: string | null;
  /**
   * Thread type when creating a new thread
   * Only used when creating a new thread (isNew=true, scope='thread')
   */
  threadType?: IThreadType;
  /**
   * Topic ID
   */
  topicId?: string | null;
  /**
   * Topic share ID for public access (used by shared topic pages)
   * When present, allows unauthenticated access to topic messages
   */
  topicShareId?: string;
}
