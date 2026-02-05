'use client';

import type {ConversationContext, SendMessageParams} from '@lobechat/types';
import { useMemo } from 'react';

import type {ConversationHooks} from '@/features/Conversation';
import { useChatStore } from '@/store/chat';

/**
 * Hook to create ConversationHooks for Group chat
 *
 * Intercepts the default send flow and routes to Group-specific logic:
 * - Uses sendGroupMessage from ChatStore (aiAgent/agentGroup slice)
 * - Supports supervisor decision mode or direct @mentions
 * - Future: will integrate with backend Agent mode (aiAgent.execAgent)
 *
 * @param context - The group conversation context
 * @returns ConversationHooks for use with ConversationProvider
 */
export function useGroupHooks(context: ConversationContext): ConversationHooks {
  const sendGroupMessage = useChatStore((s) => s.sendGroupMessage);

  return useMemo(
    (): ConversationHooks => ({
      /**
       * Intercept send and route to Group-specific logic
       *
       * Returns false to prevent the default ChatStore.sendMessage flow.
       * Instead, we use sendGroupMessage which handles:
       * - Supervisor decision (if enabled)
       * - Direct @mentions (if supervisor disabled)
       * - Future: backend Agent execution
       */
      onBeforeSendMessage: async (params: SendMessageParams) => {
        const { groupId } = context;

        if (!groupId) {
          console.warn('[useGroupHooks] No groupId in context, falling back to default send');
          return true; // Allow default flow
        }

        // Route to Group-specific send logic
        await sendGroupMessage({ context, files: params.files, message: params.message });

        // Return false to prevent default ChatStore.sendMessage
        return false;
      },
    }),
    [context],
  );
}
