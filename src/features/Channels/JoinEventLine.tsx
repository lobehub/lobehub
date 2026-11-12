import * as stylex from '@stylexjs/stylex';
import { Trans, useTranslation } from 'react-i18next';

import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import type { ChannelJoinEvent } from './joinEvents';
import { MemberAvatar } from './MemberAvatar';
import { isCurrentUserMember, memberName } from './memberName';
import { styles } from './styles';

/** “You invited A, B and C to the channel”, as a system line in the timeline. */
export function JoinEventLine({ event: { inviter, members } }: { event: ChannelJoinEvent }) {
  const { t, i18n } = useTranslation('channel');
  const userId = useUserStore(userProfileSelectors.userId);
  const names = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).formatToParts(
    members.map((member) => memberName(member, t('deletedMember'))),
  );
  const key = !inviter
    ? 'events.membersJoined'
    : isCurrentUserMember(inviter, userId)
      ? 'events.youInvitedMembers'
      : 'events.invitedMembers';
  let memberIndex = 0;
  return (
    <div role="note" {...stylex.props(styles.event)}>
      <Trans
        i18nKey={key}
        ns="channel"
        values={{ inviter: inviter && memberName(inviter, t('deletedMember')) }}
        components={{
          members: (
            <span>
              {names.map((part) => {
                if (part.type === 'literal') return part.value;
                const member = members[memberIndex++];
                const content = (
                  <span
                    key={member.id}
                    {...stylex.props(
                      styles.eventMember,
                      !!member.agentId && styles.eventMemberAgent,
                    )}
                  >
                    <MemberAvatar member={member} size={18} />
                    <span {...stylex.props(styles.eventMemberName)}>{part.value}</span>
                  </span>
                );
                if (!member.agentId) return content;
                return (
                  // Same profile card an Agent shows on hover on its messages.
                  <AgentProfilePopup
                    agentId={member.agentId}
                    key={member.id}
                    trigger={'hover'}
                    agent={{
                      avatar: member.avatar,
                      description: member.description,
                      title: part.value,
                    }}
                  >
                    {content}
                  </AgentProfilePopup>
                );
              })}
            </span>
          ),
        }}
      />
    </div>
  );
}
