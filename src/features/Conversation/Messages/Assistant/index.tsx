'use client';

import { LOADING_FLAT } from '@lobechat/const';
import type { EmojiReaction } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import type { MouseEventHandler, ReactNode } from 'react';
import { memo, useCallback, useMemo } from 'react';

import { MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES } from '@/const/messageActionPortal';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors, userProfileSelectors } from '@/store/user/selectors';

import { ReactionDisplay } from '../../components/Reaction';
import ErrorMessageExtra, { useErrorContent } from '../../Error';
import { useAgentMeta, useDoubleClickEdit } from '../../hooks';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { normalizeThinkTags, processWithArtifact } from '../../utils/markdown';
import MessageBranch from '../components/MessageBranch';
import {
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from '../Contexts/message-action-context';
import MessageWorks from '../MessageWorks';
import InterruptedHint from './components/InterruptedHint';
import MessageContent from './components/MessageContent';
import { AssistantMessageExtra } from './Extra';

const actionBarHolder = (
  <div {...{ [MESSAGE_ACTION_BAR_PORTAL_ATTRIBUTES.assistant]: '' }} style={{ height: '28px' }} />
);

interface AssistantMessageProps {
  disableEditing?: boolean;
  footerRender?: ReactNode;
  id: string;
  index: number;
  isLatestItem?: boolean;
}

const AssistantMessage = memo<AssistantMessageProps>(
  ({ id, index, disableEditing, footerRender }) => {
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

    // Get editing, generating, creating, and interrupted state from ConversationStore
    const editing = useConversationStore(messageStateSelectors.isMessageEditing(id));
    const generating = useConversationStore(messageStateSelectors.isMessageGenerating(id));
    const isCreating = useConversationStore(messageStateSelectors.isMessageCreating(id));
    const interrupted = useConversationStore(messageStateSelectors.isMessageInterrupted(id));
    const addReaction = useConversationStore((s) => s.addReaction);
    const removeReaction = useConversationStore((s) => s.removeReaction);
    const userId = useUserStore(userProfileSelectors.userId)!;
    const reactions = useMemo<EmojiReaction[]>(
      () => metadata?.reactions || [],
      [metadata?.reactions],
    );

    const handleReactionClick = useCallback(
      (emoji: string) => {
        const existing = reactions.find((reaction) => reaction.emoji === emoji);
        if (existing?.users.includes(userId)) {
          removeReaction(id, emoji);
        } else {
          addReaction(id, emoji);
        }
      },
      [addReaction, id, reactions, removeReaction, userId],
    );

    const isReactionActive = useCallback(
      (emoji: string) => {
        const reaction = reactions.find((item) => item.emoji === emoji);
        return !!reaction && reaction.users.includes(userId);
      },
      [reactions, userId],
    );

    const errorContent = useErrorContent(error);

    // remove line breaks in artifact tag to make the ast transform easier
    const message = !editing ? normalizeThinkTags(processWithArtifact(content)) : content;

    const onDoubleClick = useDoubleClickEdit({ disableEditing, error, id, role });
    const setMessageItemActionElementPortialContext =
      useSetMessageItemActionElementPortialContext();
    const setMessageItemActionTypeContext = useSetMessageItemActionTypeContext();

    const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

    const onMouseEnter: MouseEventHandler<HTMLDivElement> = useCallback(
      (e) => {
        setMessageItemActionElementPortialContext(e.currentTarget);
        setMessageItemActionTypeContext({ id, index, type: 'assistant' });
      },
      [id, index, setMessageItemActionElementPortialContext, setMessageItemActionTypeContext],
    );

    const hasEmptyErrorMessage = Boolean(
      errorContent &&
      error &&
      (message === LOADING_FLAT || !message || String(message).trim() === ''),
    );

    return (
      <ChatItem
        showTitle
        aboveMessage={null}
        avatar={avatar}
        belowMessage={hasEmptyErrorMessage ? footerRender : undefined}
        // ChatItem renders this as the primary block when the message is empty,
        // or inside messageExtra (below the content) when the turn streamed
        // content before erroring — so don't gate it on empty content.
        customErrorRender={(error) => <ErrorMessageExtra data={item} error={error} />}
        editing={editing}
        error={errorContent && error ? errorContent : undefined}
        id={id}
        loading={generating || isCreating}
        message={message}
        placement={'left'}
        time={createdAt}
        actionAddon={
          reactions.length > 0 ? (
            <ReactionDisplay
              isActive={isReactionActive}
              reactions={reactions}
              onReactionClick={handleReactionClick}
            />
          ) : undefined
        }
        actions={
          <>
            {isDevMode && branch && (
              <MessageBranch
                activeBranchIndex={branch.activeBranchIndex}
                count={branch.count}
                messageId={id}
              />
            )}
            {!disableEditing && actionBarHolder}
          </>
        }
        afterActions={
          metadata?.work?.rootOperationId ? (
            <MessageWorks rootOperationId={metadata.work.rootOperationId} />
          ) : undefined
        }
        messageExtra={
          <>
            {interrupted && <InterruptedHint />}
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
            {footerRender}
          </>
        }
        onDoubleClick={onDoubleClick}
        onMouseEnter={onMouseEnter}
      >
        <MessageContent {...item} />
      </ChatItem>
    );
  },
  isEqual,
);

AssistantMessage.displayName = 'AssistantMessage';

export default AssistantMessage;
