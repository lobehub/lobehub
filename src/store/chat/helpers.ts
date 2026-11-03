import { type OpenAIChatMessage, type UIChatMessage } from '@lobechat/types';

import { encodeAsync } from '@/utils/tokenizer';

export const getMessagesTokenCount = async (messages: OpenAIChatMessage[]) =>
  encodeAsync(messages.map((m) => m.content).join(''));

export const getMessageById = (
  messages: UIChatMessage[],
  id: string,
): UIChatMessage | undefined => {
  // First try to find in top-level messages
  const directMatch = messages.find((m) => m.id === id);
  if (directMatch) return directMatch;

  // If not found, search in agentCouncil members
  for (const message of messages) {
    if (message.role === 'agentCouncil' && (message as any).members) {
      const member = (message as any).members.find((m: UIChatMessage) => m.id === id);
      if (member) return member;
    }
  }

  return undefined;
};

const getSlicedMessages = (
  messages: UIChatMessage[],
  options: {
    enableHistoryCount?: boolean;
    historyCount?: number;
    includeNewUserMessage?: boolean;
  },
): UIChatMessage[] => {
  // if historyCount is not enabled, return all messages
  if (!options.enableHistoryCount || options.historyCount === undefined) return messages;

  // if user send message, history will include this message so the total length should +1
  const messagesCount = !!options.includeNewUserMessage
    ? options.historyCount + 1
    : options.historyCount;

  // if historyCount is negative or set to 0, return empty array
  if (messagesCount <= 0) return [];

  // if historyCount is positive, return last N messages
  return messages.slice(-messagesCount);
};

export const chatHelpers = {
  getMessageById,
  getMessagesTokenCount,
  getSlicedMessages,
};
