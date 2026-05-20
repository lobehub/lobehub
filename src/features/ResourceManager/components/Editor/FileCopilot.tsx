'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

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

const actions: ActionKeys[] = ['model', 'search'];

/**
 * Help analyze and work with files
 */
const FileCopilot = memo(() => {
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  const currentAgentId = useConversationStore(conversationSelectors.agentId);

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
          <ChatInput leftActions={actions} showRuntimeConfig={false} />
        </Flexbox>
      </DragUploadZone>
    </RightPanel>
  );
});

FileCopilot.displayName = 'FileCopilot';

export default FileCopilot;
