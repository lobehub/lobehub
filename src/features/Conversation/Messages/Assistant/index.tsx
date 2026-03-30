'use client';

import { LOADING_FLAT } from '@lobechat/const';
import isEqual from 'fast-deep-equal';
import { type MouseEventHandler } from 'react';
import { memo, useCallback } from 'react';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import ErrorMessageExtra, { useErrorContent } from '../../Error';
import { useAgentMeta, useDoubleClickEdit } from '../../hooks';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { normalizeThinkTags, processWithArtifact } from '../../utils/markdown';
import MessageBranch from '../components/MessageBranch';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../Contexts/message-action-context';
import MessageContent from './components/MessageContent';
import { AssistantMessageExtra } from './Extra';

const actionBarHolder = (
  <div {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.assistant]: '' }} style={{ height: '28px' }} />
);

interface AssistantMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
  isLatestItem?: boolean;
}

const AssistantMessage = memo<AssistantMessageProps>(({ id, index, disableEditing }) => {
  // Get message and actionsConfig from ConversationStore
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual)!;

  const {
    agentId,
    branch,
    error,
    role,
    content,
    createdAt,
    tools,
    extra,
    model,
    provider,
    performance,
    usage,
    metadata,
  } = item;

  const avatar = useAgentMeta(agentId);

  // Get editing and generating state from ConversationStore
  const editing = useConversationStore(messageStateSelectors.isMessageEditing(id));
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));

  const errorContent = useErrorContent(error);

  const shouldForceShowError =
    error?.type === 'ProviderBizError' &&
    (error?.body as any)?.provider === 'google' &&
    !!(
      (error?.body as any)?.context?.promptFeedback?.blockReason ||
      (error?.body as any)?.context?.finishReason
    );

  // remove line breaks in artifact tag to make the ast transform easier
  const message = !editing ? normalizeThinkTags(processWithArtifact(content)) : content;

  const onDoubleClick = useDoubleClickEdit({ disableEditing, error, id, role });
  const setMessageItemActionElementPortialContext = useSetMessageItemActionElementPortialContext();
  const setMessageItemActionTypeContext = useSetMessageItemActionTypeContext();

  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  const onMouseEnter: MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      setMessageItemActionElementPortialContext(e.currentTarget);
      setMessageItemActionTypeContext({ id, index, type: 'assistant' });
    },
    [id, index, setMessageItemActionElementPortialContext, setMessageItemActionTypeContext],
  );

  return (
    <ChatItem
      showTitle
      aboveMessage={null}
      avatar={avatar}
      customErrorRender={(error) => <ErrorMessageExtra data={item} error={error} />}
      editing={editing}
      id={id}
      loading={generating}
      message={message}
      placement={'left'}
      time={createdAt}
      actions={
        <>
          {isDevMode && branch && (
            <MessageBranch
              activeBranchIndex={branch.activeBranchIndex}
              count={branch.count}
              messageId={id}
            />
          )}
          {actionBarHolder}
        </>
      }
      error={
        errorContent && error && (message === LOADING_FLAT || !message || shouldForceShowError)
          ? errorContent
          : undefined
      }
      messageExtra={
        <AssistantMessageExtra
          content={content}
          extra={extra}
          id={id}
          model={model!}
          performance={performance! || metadata}
          provider={provider!}
          tools={tools}
          usage={usage! || metadata}
        />
      }
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
    >
      <MessageContent {...item} />
    </ChatItem>
  );
}, isEqual);

AssistantMessage.displayName = 'AssistantMessage';

export default AssistantMessage;
