import { useEffect } from 'react';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { mcpAppActions } from '@/store/mcpApp/action';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

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
    const observe = () => {
      const state = api.getState();
      for (const message of state.dbMessages) {
        message.tools?.forEach((tool, index) => {
          const operation = state.operationState.getToolOperationState(message.id, index, tool.id);
          if (operation.isInvoking || operation.isStreaming) mcpAppActions.markLive(tool.id);
        });
      }
    };
    observe();
    const unsubscribe = api.subscribe(observe);
    return () => {
      unsubscribe();
      unregister();
    };
  }, [api, enabled, scope, writable]);
  return null;
};
