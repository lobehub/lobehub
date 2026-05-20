import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import Loading from '@/components/Loading/BrandTextLoading';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import ConversationArea from './ConversationArea';

const wrapperStyle: React.CSSProperties = {
  flex: 1,
  height: '100%',
  minWidth: 300,
  width: '100%',
};

const ChatConversation = memo(() => {
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  return (
    <Suspense fallback={<Loading debugId="Agent > ChatConversation" />}>
      <DragUploadZone style={wrapperStyle} onUploadFiles={handleUploadFiles}>
        <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
          <TooltipGroup>
            <ConversationArea />
          </TooltipGroup>
        </Flexbox>
      </DragUploadZone>
    </Suspense>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
