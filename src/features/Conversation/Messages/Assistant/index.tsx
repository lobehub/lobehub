'use client';

import { LOADING_FLAT } from '@lobechat/const';
import isEqual from 'fast-deep-equal';
import { type MouseEventHandler, memo, useCallback } from 'react';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useNewScreen } from '@/features/Conversation/Messages/components/useNewScreen';

import ErrorMessageExtra, { useErrorContent } from '../../Error';
import { useAgentMeta, useDoubleClickEdit } from '../../hooks';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { normalizeThinkTags, processWithArtifact } from '../../utils/markdown';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../Contexts/message-action-context';
import MessageBranch from '../components/MessageBranch';
import { AssistantMessageExtra } from './Extra';
import MessageContent from './components/MessageContent';

const actionBarHolder = (
  <div {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.assistant]: '' }} style={{ height: '28px' }} />
);

interface AssistantMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
  isLatestItem?: boolean;
}

const AssistantMessage = memo<AssistantMessageProps>(
  ({ id, index, disableEditing, isLatestItem }) => {
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
    const creating = useConversationStore(messageStateSelectors.isMessageCreating(id));
    const newScreen = useNewScreen({ creating, isLatestItem });

    const errorContent = useErrorContent(error);

    // remove line breaks in artifact tag to make the ast transform easier
    const message = !editing ? normalizeThinkTags(processWithArtifact(content)) : content;

    const onDoubleClick = useDoubleClickEdit({ disableEditing, error, id, role });
    const setMessageItemActionElementPortialContext =
      useSetMessageItemActionElementPortialContext();
    const setMessageItemActionTypeContext = useSetMessageItemActionTypeContext();

    const onMouseEnter: MouseEventHandler<HTMLDivElement> = useCallback(
      (e) => {
        setMessageItemActionElementPortialContext(e.currentTarget);
        setMessageItemActionTypeContext({ id, index, type: 'assistant' });
      },
      [id, index, setMessageItemActionElementPortialContext, setMessageItemActionTypeContext],
    );

    return (
      <ChatItem
        aboveMessage={null}
        actions={
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
        }
        avatar={avatar}
        customErrorRender={(error) => <ErrorMessageExtra data={item} error={error} />}
        editing={editing}
        error={
          errorContent && error && (message === LOADING_FLAT || !message) ? errorContent : undefined
        }
        id={id}
        loading={generating}
        message={message}
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
        newScreen={newScreen}
        onDoubleClick={onDoubleClick}
        onMouseEnter={onMouseEnter}
        placement={'left'}
        showTitle
        time={createdAt}
      >
        <MessageContent {...item} />
      </ChatItem>
    );
  },
  isEqual,
);

AssistantMessage.displayName = 'AssistantMessage';

export default AssistantMessage;
