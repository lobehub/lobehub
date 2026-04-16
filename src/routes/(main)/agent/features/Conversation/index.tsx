import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense, useEffect, useState } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import Loading from '@/components/Loading/BrandTextLoading';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import ConversationArea from './ConversationArea';
import ChatHeader from './Header';
import AgentWorkingSidebar from './WorkingSidebar';

const wrapperStyle: React.CSSProperties = {
  height: '100%',
  minWidth: 300,
  width: '100%',
};

const ChatConversation = memo(() => {
  const showHeader = useGlobalStore(systemStatusSelectors.showChatHeader);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);

  // Get current agent's model info for vision support check
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  useEffect(() => {
    setSelectedDocumentId(null);
  }, [activeAgentId]);

  return (
    <Suspense fallback={<Loading debugId="Agent > ChatConversation" />}>
      <DragUploadZone style={wrapperStyle} onUploadFiles={handleUploadFiles}>
        <Flexbox
          horizontal
          height={'100%'}
          style={{ overflow: 'hidden', position: 'relative' }}
          width={'100%'}
        >
          <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
            {showHeader && <ChatHeader />}
            <TooltipGroup>
              <ConversationArea />
            </TooltipGroup>
          </Flexbox>
          <AgentWorkingSidebar
            selectedDocumentId={selectedDocumentId}
            onSelectDocument={setSelectedDocumentId}
          />
        </Flexbox>
      </DragUploadZone>
    </Suspense>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
