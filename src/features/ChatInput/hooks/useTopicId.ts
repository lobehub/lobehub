'use client';

import { useChatStore } from '@/store/chat';

import { useChatInputStore } from '../store';

/**
 * The topic this ChatInput belongs to.
 *
 * Hosts that own a conversation publish their own topic into the ChatInput
 * store (see `Conversation/ChatInput`), including `null` when that conversation
 * deliberately has no topic — a page copilot embedded beside another chat keeps
 * `topicId: null` while the outer chat's topic is still the global
 * `activeTopicId`, so reading the global id there would bind the composer to an
 * unrelated topic and let its controls write to it.
 *
 * Hosts without a conversation of their own (the Home composer, standalone
 * editors) provide nothing, and fall back to the global active topic the way
 * they always have.
 */
export const useTopicId = (): string | null => {
  const topicIdFromChatInput = useChatInputStore((s) => s.topicId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  // `null` is a valid value ("this conversation has no topic") and must NOT
  // fall back, the same distinction `useAgentId` makes for an empty agentId.
  return topicIdFromChatInput !== undefined ? topicIdFromChatInput : (activeTopicId ?? null);
};
