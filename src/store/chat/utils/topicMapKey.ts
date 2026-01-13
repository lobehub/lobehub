/**
 * Topic scope types
 * - 'agent': Agent main topic list (default when only agentId)
 * - 'group': Group main topic list (when groupId without agentId)
 * - 'group_agent': Agent topic list within a group (when both groupId and agentId)
 */
export type TopicMapScope = 'agent' | 'group' | 'group_agent';

export interface TopicMapKeyInput {
  /**
   * Agent ID - used for agent sessions or agent within group
   */
  agentId?: string;
  /**
   * Group ID - used for group sessions
   */
  groupId?: string;
  /**
   * Explicit scope override (auto-detected if not provided)
   */
  scope?: TopicMapScope;
}

/**
 * Generate a unique key for topic data map based on session context
 *
 * Auto-detection rules:
 * - If groupId && agentId: scope = 'group_agent'
 * - If groupId only: scope = 'group'
 * - If agentId only: scope = 'agent'
 *
 * Key format:
 * - Agent session: `agent_{agentId}`
 * - Group session: `group_{groupId}`
 * - Agent within group: `group_agent_{groupId}_{agentId}`
 */
export const topicMapKey = (input: TopicMapKeyInput): string => {
  const { agentId, groupId, scope: explicitScope } = input;

  // Auto-detect scope if not explicitly provided
  let scope: TopicMapScope;
  if (explicitScope) {
    scope = explicitScope;
  } else if (groupId && agentId) {
    scope = 'group_agent';
  } else if (groupId) {
    scope = 'group';
  } else {
    scope = 'agent';
  }

  switch (scope) {
    case 'group_agent': {
      return `group_agent_${groupId}_${agentId}`;
    }
    case 'group': {
      return `group_${groupId}`;
    }

    default: {
      return `agent_${agentId}`;
    }
  }
};
