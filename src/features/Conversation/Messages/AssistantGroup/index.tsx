'use client';

import type { AssistantContentBlock } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type MouseEventHandler, Suspense, memo, useCallback, useMemo } from 'react';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useNewScreen } from '@/features/Conversation/Messages/components/useNewScreen';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import dynamic from '@/libs/next/dynamic';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';

import { useAgentMeta } from '../../hooks';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../Contexts/message-action-context';
import FileListViewer from '../User/components/FileListViewer';
import Usage from '../components/Extras/Usage';
import MessageBranch from '../components/MessageBranch';
import Group from './components/Group';

const EditState = dynamic(() => import('./components/EditState'), {
  ssr: false,
});

const actionBarHolder = (
  <div
    {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.assistantGroup]: '' }}
    style={{ height: '28px' }}
  />
);
interface GroupMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
  isLatestItem?: boolean;
}

const GroupMessage = memo<GroupMessageProps>(({ id, index, disableEditing, isLatestItem }) => {
  // Get message and actionsConfig from ConversationStore
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;

  const { agentId, usage, createdAt, children, performance, model, provider, branch } = item;
  const avatar = useAgentMeta(agentId);

  // Collect fileList from all children blocks
  const aggregatedFileList = useMemo(() => {
    if (!children || children.length === 0) return [];
    return children.flatMap((child: AssistantContentBlock) => child.fileList || []);
  }, [children]);

  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const [toggleSystemRole] = useGlobalStore((s) => [s.toggleSystemRole]);
  const openChatSettings = useOpenChatSettings();

  // Get the latest message block from the group that doesn't contain tools
  const lastAssistantMsg = useConversationStore(
    dataSelectors.getGroupLatestMessageWithoutTools(id),
  );

  const contentId = lastAssistantMsg?.id;

  // Get editing state from ConversationStore
  const editing = useConversationStore(messageStateSelectors.isMessageEditing(contentId || ''));
  const creating = useConversationStore(messageStateSelectors.isMessageCreating(id));
  const { minHeight } = useNewScreen({ creating, isLatestItem, messageId: id });

  const setMessageItemActionElementPortialContext = useSetMessageItemActionElementPortialContext();
  const setMessageItemActionTypeContext = useSetMessageItemActionTypeContext();

  const onMouseEnter: MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (disableEditing) return;
      setMessageItemActionElementPortialContext(e.currentTarget);
      setMessageItemActionTypeContext({ id, index, type: 'assistantGroup' });
    },
    [
      disableEditing,
      id,
      index,
      setMessageItemActionElementPortialContext,
      setMessageItemActionTypeContext,
    ],
  );

  const onAvatarClick = useCallback(() => {
    if (!isInbox) {
      toggleSystemRole(true);
    } else {
      openChatSettings();
    }
  }, [isInbox]);

  return (
    <ChatItem
      actions={
        !disableEditing && (
          <>
            {branch && (
              <MessageBranch
                activeBranchIndex={branch.activeBranchIndex}
                count={branch.count}
                messageId={id}
              />
            )}
            {actionBarHolder}
          </>
        )
      }
      avatar={avatar}
      newScreenMinHeight={minHeight}
      onAvatarClick={onAvatarClick}
      onMouseEnter={onMouseEnter}
      placement={'left'}
      showTitle
      time={createdAt}
    >
      {children && children.length > 0 && (
        <Group
          blocks={children}
          content={lastAssistantMsg?.content}
          contentId={contentId}
          disableEditing={disableEditing}
          id={id}
          messageIndex={index}
        />
      )}
      {aggregatedFileList.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <FileListViewer items={aggregatedFileList} />
        </div>
      )}
      {model && (
        <Usage model={model} performance={performance} provider={provider!} usage={usage} />
      )}
      <Suspense fallback={null}>
        {editing && contentId && <EditState content={lastAssistantMsg?.content} id={contentId} />}
      </Suspense>
    </ChatItem>
  );
}, isEqual);

export default GroupMessage;
