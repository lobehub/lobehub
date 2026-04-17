'use client';

import isEqual from 'fast-deep-equal';
import { type MouseEventHandler } from 'react';
import { memo, useCallback } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import { ChatItem } from '@/features/Conversation/ChatItem';
import ErrorMessageExtra, { useErrorContent } from '@/features/Conversation/Error';
import { AssistantMessageExtra } from '@/features/Conversation/Messages/Assistant/Extra';
import { normalizeThinkTags, processWithArtifact } from '@/features/Conversation/utils/markdown';
import { type UIChatMessage } from '@/types/index';

import { useAgentMeta } from '../../../hooks';
import { messageStateSelectors, useConversationStore } from '../../../store';
import MessageContent from '../../Assistant/components/MessageContent';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../../Contexts/message-action-context';
import AutoScrollShadow from './AutoScrollShadow';

const actionBarHolder = (
  <div {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.assistant]: '' }} style={{ height: '28px' }} />
);

interface CouncilMemberProps {
  index: number;
  item: UIChatMessage;
}

const CouncilMember = memo<CouncilMemberProps>(({ item, index }) => {
  const {
    id,
    agentId,
    error,
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

  const editing = useConversationStore(messageStateSelectors.isMessageEditing(id));
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const errorContent = useErrorContent(error);
  const message = !editing ? normalizeThinkTags(processWithArtifact(content)) : content;

  const setMessageItemActionElementPortialContext = useSetMessageItemActionElementPortialContext();
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
      showTitle
      aboveMessage={null}
      actions={actionBarHolder}
      avatar={avatar}
      customErrorRender={(error) => <ErrorMessageExtra data={item} error={error} />}
      editing={editing}
      id={id}
      loading={generating}
      message={message}
      placement={'left'}
      time={createdAt}
      error={
        errorContent && error && (message === LOADING_FLAT || !message) ? errorContent : undefined
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
      onMouseEnter={onMouseEnter}
    >
      <AutoScrollShadow content={content} streaming={generating}>
        <MessageContent {...item} />
      </AutoScrollShadow>
    </ChatItem>
  );
}, isEqual);

CouncilMember.displayName = 'CouncilMember';

export default CouncilMember;
