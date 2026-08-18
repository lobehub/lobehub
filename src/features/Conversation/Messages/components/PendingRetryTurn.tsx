'use client';

import { Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { ChatItem } from '@/features/Conversation/ChatItem';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import { useAgentMeta } from '../../hooks';
import ContentLoading from './ContentLoading';
import { usePendingRetryTurn } from './usePendingRetryTurn';

interface PendingRetryTurnProps {
  /** The user turn being retried — the retry operation is keyed to it. */
  userMessageId: string;
}

/**
 * Stand-in reply shown while a retry is in flight and the turn it replaces is
 * already gone.
 *
 * A retry deletes the failed turn BEFORE the replacement exists (delete-first is
 * deliberate — regenerating first switches the branch away and strands the failed
 * attempt). Measured on the real app, that leaves ~250ms in which the user turn
 * has no reply under it at all: the error card they clicked vanishes and nothing
 * takes its place, so the click reads as "nothing happened".
 *
 * The message-level loading state cannot cover this — there is no message left to
 * carry it. So the pending state belongs to the USER turn, which survives the
 * whole window, and this renders the reply that is on its way.
 */
const PendingRetryTurn = memo<PendingRetryTurnProps>(({ userMessageId }) => {
  const { agentId, groupId, showPendingTurn } = usePendingRetryTurn(userMessageId);
  const avatar = useAgentMeta(agentId);
  const groupMeta = useAgentGroupStore((s) => agentGroupSelectors.getGroupMeta(groupId ?? '')(s));
  const memberAvatars = useAgentGroupStore(
    (s) => agentGroupSelectors.getGroupMemberAvatars(groupId ?? '')(s),
    isEqual,
  );
  const { t } = useTranslation('chat');

  if (!showPendingTurn) return null;

  const isGroupRetry = !!groupId;

  return (
    <ChatItem
      loading
      showTitle
      avatar={isGroupRetry ? { ...avatar, name: undefined, title: groupMeta.title } : avatar}
      id={`${userMessageId}-pending-retry`}
      placement={'left'}
      titleAddon={isGroupRetry ? <Tag>{t('supervisor.label')}</Tag> : undefined}
      customAvatarRender={
        isGroupRetry
          ? () => (
              <AgentGroupAvatar
                avatar={groupMeta.avatar}
                backgroundColor={groupMeta.backgroundColor}
                memberAvatars={memberAvatars}
              />
            )
          : undefined
      }
    >
      <ContentLoading id={userMessageId} />
    </ChatItem>
  );
});

PendingRetryTurn.displayName = 'PendingRetryTurn';

export default PendingRetryTurn;
