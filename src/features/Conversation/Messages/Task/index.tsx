'use client';

import { LOADING_FLAT } from '@lobechat/const';
import { Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatItem } from '@/features/Conversation/ChatItem';
import TaskAvatar from '@/features/Conversation/Messages/Tasks/shared/TaskAvatar';
import { useNewScreen } from '@/features/Conversation/Messages/components/useNewScreen';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';

import ErrorMessageExtra, { useErrorContent } from '../../Error';
import { useAgentMeta, useDoubleClickEdit } from '../../hooks';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { normalizeThinkTags, processWithArtifact } from '../../utils/markdown';
import { AssistantActionsBar } from './Actions';
import TaskDetailPanel from './TaskDetailPanel';

interface TaskMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
  isLatestItem?: boolean;
}

const TaskMessage = memo<TaskMessageProps>(({ id, index, disableEditing, isLatestItem }) => {
  const { t } = useTranslation('chat');

  // Get message and actionsConfig from ConversationStore
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;
  const actionsConfig = useConversationStore((s) => s.actionsBar?.assistant);

  const { agentId, error, role, content, createdAt, metadata, taskDetail } = item;

  const avatar = useAgentMeta(agentId);

  // Get editing and generating state from ConversationStore
  const editing = useConversationStore(messageStateSelectors.isMessageEditing(id));
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const creating = useConversationStore(messageStateSelectors.isMessageCreating(id));
  const newScreen = useNewScreen({ creating: generating || creating, isLatestItem });

  const errorContent = useErrorContent(error);

  // remove line breaks in artifact tag to make the ast transform easier
  const message = !editing ? normalizeThinkTags(processWithArtifact(content)) : content;

  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const [toggleSystemRole] = useGlobalStore((s) => [s.toggleSystemRole]);
  const openChatSettings = useOpenChatSettings();

  const onAvatarClick = useCallback(() => {
    if (!isInbox) {
      toggleSystemRole(true);
    } else {
      openChatSettings();
    }
  }, [isInbox]);

  const onDoubleClick = useDoubleClickEdit({ disableEditing, error, id, role });

  // Use taskTitle from metadata if available, otherwise fall back to avatar title
  const title = metadata?.taskTitle || avatar?.title;

  return (
    <ChatItem
      aboveMessage={null}
      actions={
        <AssistantActionsBar actionsConfig={actionsConfig} data={item} id={id} index={index} />
      }
      avatar={{ ...avatar, title }}
      customAvatarRender={(_, node) => <TaskAvatar>{node}</TaskAvatar>}
      customErrorRender={(error) => <ErrorMessageExtra data={item} error={error} />}
      editing={editing}
      error={
        errorContent && error && (message === LOADING_FLAT || !message) ? errorContent : undefined
      }
      id={id}
      loading={generating}
      message={message}
      newScreen={newScreen}
      onAvatarClick={onAvatarClick}
      onDoubleClick={onDoubleClick}
      placement={'left'}
      showTitle
      time={createdAt}
      titleAddon={<Tag>{t('task.subtask')}</Tag>}
    >
      <TaskDetailPanel
        content={content}
        instruction={metadata?.instruction}
        messageId={id}
        taskDetail={taskDetail}
      />
    </ChatItem>
  );
}, isEqual);

TaskMessage.displayName = 'AssistantMessage';

export default TaskMessage;
