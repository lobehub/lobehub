import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import { useAgentContext } from '@/features/Conversation/useAgentContext';
import { useLocalPathReference } from '@/features/Conversation/useLocalPathReference';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import ConversationArea from './ConversationArea';

const wrapperStyle: React.CSSProperties = {
  flex: 1,
  height: '100%',
  minWidth: 300,
  width: '100%',
};

const ChatConversation = memo(() => {
  const { agentId, topicId } = useAgentContext();
  const model = useAgentStore(agentByIdSelectors.getAgentModelById(agentId));
  const provider = useAgentStore(agentByIdSelectors.getAgentModelProviderById(agentId));

  // Drag-drop upload bypasses the (view-only-disabled) input editor, so the
  // drop zone itself follows the same per-resource General-access rules as the
  // chat input: inbox and private agents are never gated.
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentVisibility = useAgentStore((s) =>
    agentId ? s.agentMap[agentId]?.visibility : undefined,
  );
  const gatedResourceId =
    agentId && agentId !== inboxAgentId && agentVisibility !== 'private' ? agentId : undefined;
  const { canUseResource } = useResourceAccess('agent', gatedResourceId);

  const { handleUploadFiles } = useUploadFiles({ agentId, model, provider });
  const { enableLocalPathReference, handleLocalPaths } = useLocalPathReference(agentId, topicId);

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
