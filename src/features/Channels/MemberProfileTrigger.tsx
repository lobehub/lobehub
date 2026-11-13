import type { ChannelPublicMember } from '@lobechat/types';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import MemberProfilePopup from '@/features/MemberProfileCard/MemberProfilePopup';

import { memberName } from './memberName';

/**
 * Hovering a Channel member shows who they are: the Agent's profile card, or a
 * workspace person's member card. Deleted members and people outside the
 * workspace directory keep the bare avatar.
 */
export function MemberProfileTrigger({
  children,
  member,
}: {
  children: ReactNode;
  member: ChannelPublicMember;
}) {
  const { t } = useTranslation('channel');

  if (member.actorType === 'agent' && member.agentId)
    return (
      <AgentProfilePopup
        agentId={member.agentId}
        trigger={'hover'}
        agent={{
          avatar: member.avatar,
          description: member.description,
          title: memberName(member, t('deletedMember')),
        }}
      >
        <span style={{ display: 'inline-flex', minWidth: 0 }}>{children}</span>
      </AgentProfilePopup>
    );

  if (member.actorType === 'user' && member.userId)
    return <MemberProfilePopup userId={member.userId}>{children}</MemberProfilePopup>;

  return children;
}
