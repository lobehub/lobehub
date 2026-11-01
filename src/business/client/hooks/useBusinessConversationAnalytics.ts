import type { ConversationContext, ConversationHooks } from '@/features/Conversation/types';

const EMPTY_HOOKS: ConversationHooks = {};

export const useBusinessConversationAnalytics = (
  _context: ConversationContext,
): ConversationHooks => EMPTY_HOOKS;
