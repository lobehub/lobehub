import type { UIChatMessage } from '@lobechat/types';

const chatMessage = (message: UIChatMessage) => {
  return `<${message.role}>${message.content}</${message.role}>`;
};

export const chatHistoryPrompts = (messages: UIChatMessage[]) => {
  return `<chat_history>
${messages.map((m) => chatMessage(m)).join('\n')}
</chat_history>`;
};

export const groupSupervisorPrompts = (messages: UIChatMessage[]) => {
  const formatMessage = (message: UIChatMessage) => {
    const author = message.role === 'user' ? 'user' : message.agentId || 'assistant';
    const targetAttr = message.targetId ? ` target="${message.targetId}"` : '';
    return `<message author="${author}"${targetAttr}>${message.content}</message>`;
  };

  // Filter out supervisor's own messages to avoid self-referencing
  const filteredMessages = messages.filter((message) => message.role !== 'supervisor');

  return filteredMessages.map((m) => formatMessage(m)).join('\n');
};

export const groupMemeberSpeakingPrompts = (messages: UIChatMessage[]) => {
  return `<chat_group>
${messages.map((m) => chatMessage(m)).join('\n')}
</chat_group>`;
};

/**
 * Filters messages that an agent should see based on DM targeting rules
 * - Agent sees all group messages (no targetId)
 * - Agent sees DMs where they are the target
 * - Agent sees DMs they sent
 * - Agent sees user messages that are group messages or targeted to them
 * - For DM messages not involving the agent, content is replaced with "***"
 *
 * TODO: Use context engineering to filter messages
 */
export const filterMessagesForAgent = (
  messages: UIChatMessage[],
  agentId: string,
): UIChatMessage[] => {
  return messages
    .filter((message) => {
      // Exclude supervisor messages (messages with role="supervisor")
      if (message.role === 'supervisor') {
        return false;
      }
      return true;
    })
    .map((message) => {
      // Always include system messages as-is
      if (message.role === 'system') {
        return message;
      }

      // For user messages, check DM targeting rules
      if (message.role === 'user') {
        // If no target specified, it's a group message - include it as-is
        if (!message.targetId) {
          return message;
        }

        // If the message is targeted to this agent, include it as-is
        if (message.targetId === agentId) {
          return message;
        }

        // Otherwise, it's a DM to another agent - replace content with "***"
        return {
          ...message,
          content: '***',
        };
      }

      // For assistant messages, check DM targeting rules
      if (message.role === 'assistant') {
        // If no target specified, it's a group message - include it as-is
        if (!message.targetId) {
          return message;
        }

        // If the agent is the target of the DM, include it as-is
        if (message.targetId === agentId) {
          return message;
        }

        // If the agent sent the message, include it as-is
        if (message.agentId === agentId) {
          return message;
        }

        // Otherwise, it's a DM not involving this agent - replace content with "***"
        return {
          ...message,
          content: '***',
        };
      }

      // Default: include the message as-is
      return message;
    });
};

/**
 * Consolidates group chat message history into a single formatted string
 * for use in system messages. Each message is formatted as "(AuthorName): content"
 */
export const consolidateGroupChatHistory = (
  messages: UIChatMessage[],
  agents: { id: string; title: string }[] = [],
) => {
  if (messages.length === 0) return '';

  // Create a map for quick agent lookup
  const agentMap = new Map(agents.map((agent) => [agent.id, agent.title]));

  const formatMessage = (message: UIChatMessage) => {
    let authorName: string;

    if (message.role === 'user') {
      authorName = 'User';
    } else if (message.role === 'assistant' && message.agentId) {
      // Try to get agent title from the provided agents map
      authorName = agentMap.get(message.agentId) || `Agent ${message.agentId}`;
    } else {
      authorName = 'Assistant';
    }

    return `(${authorName}): ${message.content}`;
  };

  return messages
    .filter((m) => m.content && m.content.trim()) // Filter out empty messages
    .map(formatMessage)
    .join('\n');
};
