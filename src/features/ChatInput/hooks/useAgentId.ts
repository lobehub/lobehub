'use client';

import { useAgentStore } from '@/store/agent';

import { useChatInputStore } from '../store';

/**
 * Hook to get the effective agentId for ChatInput components.
 * Returns agentId from ChatInput store if provided (including empty string),
 * otherwise falls back to activeAgentId.
 *
 * Note: Empty string is a valid value (e.g., when Group's supervisorAgentId is not loaded yet),
 * so we only fallback when agentId is undefined (not provided).
 */
export const useAgentId = () => {
  const agentIdFromChatInput = useChatInputStore((s) => s.agentId);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  // Only fallback to activeAgentId when agentIdFromChatInput is undefined (not provided)
  // Empty string is a valid value and should NOT trigger fallback
  return agentIdFromChatInput !== undefined ? agentIdFromChatInput : activeAgentId || '';
};
