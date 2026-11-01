'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AssigneeProfileAvatar from './AssigneeProfileAvatar';

/** Who did a thing, by face and name — shared by the activity timeline and the decision list. */

export const AgentActor = memo<{ agentId: string }>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const meta = useAgentDisplayMeta(agentId);

  // The node titles give way first — who acted stays readable, and only a very
  // long agent name is capped.
  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={6}>
      <AssigneeProfileAvatar agentId={agentId} size={16} />
      <Text ellipsis fontSize={13} style={{ maxWidth: 120 }} weight={500}>
        {meta?.title ?? t('goalProcess.actor.agent')}
      </Text>
    </Flexbox>
  );
});

AgentActor.displayName = 'GoalAgentActor';

export const UserActor = memo<{ userId?: string | null }>(({ userId }) => {
  const { t } = useTranslation('chat');
  const [currentUserId, nickName] = useUserStore((s) => [
    userProfileSelectors.userId(s),
    userProfileSelectors.nickName(s),
  ]);

  // Only the signed-in user can be shown by face; another member's event reads
  // as "Member" rather than borrowing this user's identity or calling it "You".
  if (userId && userId !== currentUserId)
    return (
      <Text fontSize={13} style={{ flex: 'none' }} weight={500}>
        {t('goalProcess.actor.member')}
      </Text>
    );

  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={6}>
      <UserAvatar size={16} />
      <Text ellipsis fontSize={13} style={{ maxWidth: 120 }} weight={500}>
        {nickName || t('goalProcess.actor.user')}
      </Text>
    </Flexbox>
  );
});

UserActor.displayName = 'GoalUserActor';
