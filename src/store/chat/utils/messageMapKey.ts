import { type MessageMapContext, type MessageMapScope } from '@lobechat/types';

/**
 * Input context for messageMapKey function
 * Accepts agentId/topicId/threadId format with auto-detection of scope
 */
export interface MessageMapKeyInput {
  /**
   * Agent ID (maps to scopeId in main/thread scope)
   */
  agentId: string;
  /**
   * Document ID (page scope only). The page agent is a single builtin agent
   * shared by every open document, so the documentId is what isolates one
   * document's conversation/operation bucket from another's. Maps to subTopicId
   * in page scope; ignored for every other scope.
   */
  documentId?: string;
  groupId?: string;
  /**
   * Whether this is a new/creating state (for optimistic updates)
   * For thread scope: indicates creating a new thread
   * For main scope: indicates creating a new topic
   */
  isNew?: boolean;
  /**
   * Scope type for the message map
   * @default 'main' (auto-detected based on threadId)
   */
  scope?: MessageMapScope;
  /**
   * Sub Agent ID for group orchestration scenarios
   * Used as subTopicId in group_agent scope
   */
  subAgentId?: string;
  /**
   * Thread ID (maps to subTopicId in thread scope)
   */
  threadId?: string | null;
  /**
   * Topic ID
   */
  topicId?: string | null;
}

/**
 * Convert input to MessageMapContext
 * Handles mapping from agentId/threadId to scopeId/subTopicId format
 */
const toMessageMapContext = (input: MessageMapKeyInput): MessageMapContext => {
  const { agentId, topicId, threadId, isNew, groupId, subAgentId, scope, documentId } = input;

  // Page scope: the page agent is a single shared builtin agent, so the open
  // documentId is the only thing that distinguishes one document's conversation
  // from another's. Carry it as subTopicId so the generated key isolates each
  // document; without it, document A and B collapse into the same `page_<agent>`
  // bucket and leak history / queue behind each other's operations.
  if (scope === 'page' && documentId) {
    return {
      isNew,
      scope: 'page',
      scopeId: agentId,
      subTopicId: documentId,
      topicId,
    };
  }

  // If threadId is present and scope is explicitly 'thread', use thread scope
  // Thread scope takes priority when explicitly requested, even with groupId
  // This is important for Group Chat where tasks create threads with SubAgent's agentId
  if (threadId && scope === 'thread') {
    return {
      scope: 'thread',
      scopeId: agentId,
      subTopicId: threadId,
      topicId,
    };
  }

  // If groupId is present, it's a group conversation
  if (groupId) {
    // group_agent scope: Agent's independent message stream within a group
    // subAgentId is used as subTopicId to identify agent-specific messages
    if (scope === 'group_agent' && subAgentId) {
      return {
        isNew,
        scope: 'group_agent',
        scopeId: groupId,
        subTopicId: subAgentId,
        topicId,
      };
    }

    // Default group scope
    return { isNew, scope: scope ?? 'group', scopeId: groupId, topicId };
  }

  // If threadId is present, it's an existing thread - auto-detect thread scope
  if (threadId) {
    return {
      scope: scope ?? 'thread',
      scopeId: agentId,
      subTopicId: threadId,
      topicId,
    };
  }

  // Default scope (main if not specified)
  // isNew can be used with any scope (main for new topic, thread for new thread with explicit scope)
  // Note: sub_agent scope uses same key as main scope (same conversation, just different display)
  return {
    isNew,
    scope: scope === 'sub_agent' ? 'main' : (scope ?? 'main'),
    scopeId: agentId,
    topicId,
  };
};

/**
 * Generate key from MessageMapContext
 */
const generateKey = (context: MessageMapContext): string => {
  const { scope = 'main', scopeId, topicId, subTopicId, isNew } = context;

  const base = `${scope}_${scopeId}`;

  // Has subTopicId (existing thread, agent topic in group, or page documentId).
  // Page scope is usually topicless, so guard against emitting a literal `null`
  // segment when topicId is absent.
  if (subTopicId) {
    return topicId ? `${base}_${topicId}_${subTopicId}` : `${base}_${subTopicId}`;
  }

  // New thread/sub-topic with parent topicId
  if (isNew && topicId) {
    return `${base}_${topicId}_new`;
  }

  // Existing topic
  if (topicId) {
    return `${base}_${topicId}`;
  }

  // New topic (no topicId)
  return `${base}_new`;
};

/**
 * Generate a unique key for message map based on conversation context
 *
 * Key format: `{scope}_{scopeId}[_{topicId}][_{subTopicId}][_new]`
 *
 * Scope types:
 * - main: Agent main conversation (default)
 * - thread: Agent thread conversation
 * - group: Group main conversation
 * - group_agent: Agent conversation within a group
 *
 * Examples:
 * - Main new topic: `main_agt_xxx_new`
 * - Main existing topic: `main_agt_xxx_tpc_yyy`
 * - Thread new: `thread_agt_xxx_tpc_yyy_new`
 * - Thread existing: `thread_agt_xxx_tpc_yyy_thd_zzz`
 * - Group new topic: `group_grp_xxx_new`
 * - Group existing topic: `group_grp_xxx_tpc_yyy`
 * - Group agent new topic: `group_agent_grp_xxx_tpc_yyy_new`
 * - Group agent existing topic: `group_agent_grp_xxx_tpc_yyy_tpc_zzz`
 * - Task new topic: `task_agt_xxx_new`
 * - Task existing topic: `task_agt_xxx_tpc_yyy`
 * - Page document (topicless): `page_agt_xxx_doc_zzz`
 * - Page without an open document: `page_agt_xxx_new`
 *
 * Auto-detection rules (when scope is not explicitly set):
 * - If threadId exists: scope = 'thread', subTopicId = threadId
 * - Otherwise: scope = 'main'
 */
export const messageMapKey = (input: MessageMapKeyInput): string => {
  const context = toMessageMapContext(input);
  return generateKey(context);
};
