import { isDesktop } from '@lobechat/const';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense, useCallback } from 'react';

import DragUploadZone, { type DroppedFolder, useUploadFiles } from '@/components/DragUploadZone';
import Loading from '@/components/Loading/BrandTextLoading';
import { insertLocalFolderMentions } from '@/features/ChatInput/InputEditor/insertLocalFolderMentions';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import ConversationArea from './ConversationArea';

const wrapperStyle: React.CSSProperties = {
  flex: 1,
  height: '100%',
  minWidth: 300,
  width: '100%',
};

const ChatConversation = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const isLocalSystemEnabled = useAgentStore(agentChatConfigSelectors.isLocalSystemEnabled);

  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });

  const enableLocalFolderMention = isDesktop && (isHeterogeneous || isLocalSystemEnabled);

  const handleLocalFolders = useCallback((folders: DroppedFolder[]) => {
    const editor = useChatStore.getState().mainInputEditor?.instance;
    if (!editor) return;
    insertLocalFolderMentions(editor, folders);
  }, []);

  return (
    <Suspense fallback={<Loading debugId="Agent > ChatConversation" />}>
      <DragUploadZone
        enableLocalFolderMention={enableLocalFolderMention}
        style={wrapperStyle}
        onLocalFolders={enableLocalFolderMention ? handleLocalFolders : undefined}
        onUploadFiles={handleUploadFiles}
      >
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
