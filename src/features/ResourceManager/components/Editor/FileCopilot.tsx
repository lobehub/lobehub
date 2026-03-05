'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import {
  ChatInput,
  ChatList,
  conversationSelectors,
  useConversationStore,
} from '@/features/Conversation';
import RightPanel from '@/features/RightPanel';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

const actions: ActionKeys[] = ['model', 'search'];

/**
 * Help analyze and work with files
 */
const FileCopilot = memo(() => {
  const [setActiveAgentId, useFetchAgentConfig] = useAgentStore((s) => [
    s.setActiveAgentId,
    s.useFetchAgentConfig,
  ]);
  const currentAgentId = useConversationStore(conversationSelectors.agentId);

  useEffect(() => {
    if (!currentAgentId) return;

    if (useAgentStore.getState().activeAgentId !== currentAgentId) {
      setActiveAgentId(currentAgentId);
    }

    const { activeAgentId, activeTopicId, switchTopic } = useChatStore.getState();

    if (activeAgentId !== currentAgentId) {
      useChatStore.setState(
        { activeAgentId: currentAgentId },
        false,
        'ResourceManager/FileCopilot/syncActiveAgentId',
      );
    }

    if (activeAgentId !== currentAgentId || !!activeTopicId) {
      void switchTopic(null, { scope: 'page', skipRefreshMessage: true });
    }
  }, [currentAgentId, setActiveAgentId]);

  // Fetch agent config when activeAgentId changes to ensure it's loaded in the store
  useFetchAgentConfig(true, currentAgentId);

  // Get agent's model info for vision support check
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(currentAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(currentAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  return (
    <RightPanel>
      <DragUploadZone
        style={{ flex: 1, height: '100%', minWidth: 300 }}
        onUploadFiles={handleUploadFiles}
      >
        <Flexbox flex={1} height={'100%'}>
          <Flexbox flex={1} style={{ overflow: 'hidden' }}>
            <ChatList />
          </Flexbox>
          <ChatInput leftActions={actions} />
        </Flexbox>
      </DragUploadZone>
    </RightPanel>
  );
});

FileCopilot.displayName = 'FileCopilot';

export default FileCopilot;
