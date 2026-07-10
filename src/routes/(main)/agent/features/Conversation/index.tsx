import { isDesktop } from '@lobechat/const';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense, useCallback } from 'react';

import DragUploadZone, { type DroppedLocalPath, useUploadFiles } from '@/components/DragUploadZone';
import Loading from '@/components/Loading/BrandTextLoading';
import { insertLocalPathTags } from '@/features/ChatInput/InputEditor/insertLocalFileTags';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
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
  const workingDirectory = useEffectiveWorkingDirectory(agentId);

  const enableLocalPathReference =
    isDesktop && !!workingDirectory && (isHeterogeneous || isLocalSystemEnabled);

  const handleLocalPaths = useCallback((paths: DroppedLocalPath[]) => {
    const editor = useChatStore.getState().mainInputEditor?.instance;
    if (!editor) return;
    insertLocalPathTags(editor, paths);
  }, []);

  return (
    <Suspense fallback={<Loading debugId="Agent > ChatConversation" />}>
      <DragUploadZone
        enableLocalPathReference={enableLocalPathReference}
        style={wrapperStyle}
        onLocalPaths={enableLocalPathReference ? handleLocalPaths : undefined}
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
