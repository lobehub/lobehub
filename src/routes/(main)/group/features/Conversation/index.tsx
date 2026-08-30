import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useCurrentAgentValue } from '@/store/agent/projection';

import ConversationArea from './ConversationArea';
import ChatHeader from './Header';

const ChatConversation = memo(() => {
  // Get current agent's model info for vision support check
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const model = useCurrentAgentValue(agentProjectionSelectors.model);
  const provider = useCurrentAgentValue(agentProjectionSelectors.provider);
  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });

  return (
    <DragUploadZone style={{ height: '100%', width: '100%' }} onUploadFiles={handleUploadFiles}>
      <Flexbox height={'100%'} style={{ overflow: 'hidden', position: 'relative' }} width={'100%'}>
        <ChatHeader />
        <ConversationArea />
      </Flexbox>
    </DragUploadZone>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
