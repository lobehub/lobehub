import { isDesktop } from '@lobechat/const';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense, useCallback } from 'react';

import DragUploadZone, { type DroppedLocalPath, useUploadFiles } from '@/components/DragUploadZone';
import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import { insertLocalPathTags } from '@/features/ChatInput/InputEditor/insertLocalFileTags';
import { useAgentContext } from '@/features/Conversation/useAgentContext';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useAgentRuntimeMode } from '@/helpers/gatewayMode';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useAgentValue } from '@/store/agent/projection';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import ConversationArea from './ConversationArea';

const wrapperStyle: React.CSSProperties = {
  flex: 1,
  height: '100%',
  minWidth: 300,
  width: '100%',
};

const ChatConversation = memo(() => {
  const { agentId, topicId } = useAgentContext();
  const model = useAgentValue(agentId, agentProjectionSelectors.model);
  const provider = useAgentValue(agentId, agentProjectionSelectors.provider);
  const isHeterogeneous = useAgentValue(agentId, agentProjectionSelectors.heterogeneous);
  const isLocalSystemEnabled = useAgentRuntimeMode(agentId) === 'local';

  // Drag-drop upload bypasses the (view-only-disabled) input editor, so the
  // drop zone itself follows the same per-resource General-access rules as the
  // chat input: inbox and private agents are never gated.
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentVisibility = useAgentValue(agentId, agentProjectionSelectors.visibility);
  const gatedResourceId =
    agentId && agentId !== inboxAgentId && agentVisibility !== 'private' ? agentId : undefined;
  const { canUseResource } = useResourceAccess('agent', gatedResourceId);

  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });
  const workingDirectory = useEffectiveWorkingDirectory(agentId, { topicId });

  const enableLocalPathReference =
    isDesktop && !!workingDirectory && (isHeterogeneous || isLocalSystemEnabled);

  const handleLocalPaths = useCallback((paths: DroppedLocalPath[]) => {
    const editor = useChatStore.getState().mainInputEditor?.instance;
    if (!editor) return;
    insertLocalPathTags(editor, paths);
  }, []);

  const content = (
    <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
      <TooltipGroup>
        <ConversationArea />
      </TooltipGroup>
    </Flexbox>
  );

  return (
    <Suspense fallback={<ConversationSegmentSkeleton />}>
      {canUseResource ? (
        <DragUploadZone
          enableLocalPathReference={enableLocalPathReference}
          style={wrapperStyle}
          onLocalPaths={enableLocalPathReference ? handleLocalPaths : undefined}
          onUploadFiles={handleUploadFiles}
        >
          {content}
        </DragUploadZone>
      ) : (
        <div style={wrapperStyle}>{content}</div>
      )}
    </Suspense>
  );
});

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
