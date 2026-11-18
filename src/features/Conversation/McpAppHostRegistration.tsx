import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { mcpAppActions } from '@/store/mcpApp/action';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { getLiveMcpAppToolCalls } from './mcpAppLiveCalls';
import { useConversationStore, useConversationStoreApi } from './store';

/** Conversation-only integration: reusable app views never import this host's store. */
export const McpAppHostRegistration = () => {
  const enabled = useServerConfigStore(serverConfigSelectors.enableMcpApps);
  const api = useConversationStoreApi();
  const scope = useConversationStore((s) => messageMapKey(s.context));
  const writable = useConversationStore((s) => s.composerTarget.writable);
  useEffect(() => {
    if (!enabled || !writable) return;
    const unregister = mcpAppActions.registerHost(scope, {
      agentId: api.getState().context.agentId,
      sendMessage: async (params) => {
        const current = api.getState();
        if (!current.composerTarget.writable || messageMapKey(current.context) !== scope)
          throw new Error('Conversation is no longer available');
        await current.sendMessage(params);
      },
    });
    // Observe actual in-flight calls, never infer live results from mount time or history hydration.
    const observed = new Set<string>();
    const observe = () => {
      for (const id of getLiveMcpAppToolCalls(useChatStore.getState(), scope)) {
        if (observed.has(id)) continue;
        observed.add(id);
        mcpAppActions.markLive(id);
      }
    };
    observe();
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (
        state.operations !== previous.operations ||
        state.toolCallingStreamIds !== previous.toolCallingStreamIds ||
        state.dbMessagesMap[scope] !== previous.dbMessagesMap[scope]
      )
        observe();
    });
    return () => {
      unsubscribe();
      unregister();
      mcpAppActions.forgetLive([...observed]);
    };
  }, [api, enabled, scope, writable]);
  return null;
};
