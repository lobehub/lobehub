import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import ConversationArea from './ConversationArea';
import ChatHeader from './Header';

const ChatConversation = memo(() => {
  const showHeader = useGlobalStore(systemStatusSelectors.showChatHeader);

  // Get current agent's model info for vision support check
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  return (
    <DragUploadZone style={{ height: '100%', width: '100%' }} onUploadFiles={handleUploadFiles}>
      <Flexbox height={'100%'} style={{ overflow: 'hidden', position: 'relative' }} width={'100%'}>
        {showHeader && <ChatHeader />}
        <ConversationArea />
      </Flexbox>
    </DragUploadZone>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
