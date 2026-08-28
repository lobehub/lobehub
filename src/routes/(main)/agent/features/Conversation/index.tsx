import { isDesktop } from '@lobechat/const';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import React, { memo, Suspense, useCallback } from 'react';

import DragUploadZone, { type DroppedLocalPath, useUploadFiles } from '@/components/DragUploadZone';
import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import { insertLocalPathTags } from '@/features/ChatInput/InputEditor/insertLocalFileTags';
import { useAgentContext } from '@/features/Conversation/useAgentContext';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import {
  canExecutionTargetReadLocalPaths,
  resolveExecutionTarget,
} from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import {
  agentByIdSelectors,
  builtinAgentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';

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
  const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const isLocalSystemEnabled = useAgentStore(
    chatConfigByIdSelectors.isLocalSystemEnabledById(agentId),
  );

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
  const workingDirectory = useEffectiveWorkingDirectory(agentId, { topicId });

  // A dropped `<localFile>` path only makes sense when THIS run executes
  // somewhere that can read this machine's filesystem. Resolve the effective
  // execution target (member override + workspace coercion included) instead of
  // trusting "hetero / local-system" alone — a Claude Code agent whose run
  // lands in the cloud sandbox must fall back to attachment upload, or the
  // agent receives a `/Users/...` path that does not exist in its container.
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    isHetero: isHeterogeneous,
    workspaceScoped,
  });
  const enableLocalPathReference =
    isDesktop &&
    !!workingDirectory &&
    (isHeterogeneous || isLocalSystemEnabled) &&
    canExecutionTargetReadLocalPaths(executionTarget, agencyConfig, currentDeviceId);

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
