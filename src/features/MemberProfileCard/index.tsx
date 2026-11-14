'use client';

import { Tag, Text } from '@lobehub/ui';
import { BriefcaseBusiness, ListChecks, Mail } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';
import ProfileHoverCard, { ProfileHoverCardRow } from '@/features/ProfileHoverCard';

import type { WorkspaceMemberProfile } from './useWorkspaceMemberProfile';

const KNOWN_ROLES = new Set(['admin', 'member', 'owner', 'viewer']);

const CLAMPED_TEXT = {
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 4,
  display: '-webkit-box',
  overflow: 'hidden',
  whiteSpace: 'pre-line',
} as const;

export interface MemberProfileCardProps {
  member: WorkspaceMemberProfile;
}

/**
 * A workspace member at a glance — who they are, their role in the workspace
 * and what they own — in the same shape as the Agent hover card, so people and
 * Agents read as the same kind of teammate.
 */
const MemberProfileCard = memo<MemberProfileCardProps>(({ member }) => {
  const { t } = useTranslation(['chat', 'setting']);
  const { avatar, email, name, responsibilities, role, title, username } = member;

  const roleLabel =
    role && KNOWN_ROLES.has(role)
      ? t(`workspace.member.roles.${role}` as 'workspace.member.roles.member', { ns: 'setting' })
      : role;

  return (
    <ProfileHoverCard
      avatar={<UserAvatar avatar={avatar} name={name} shape={'circle'} size={44} />}
      subtitle={username && username !== name ? `@${username}` : undefined}
      tag={roleLabel ? <Tag size={'small'}>{roleLabel}</Tag> : undefined}
      testId={'member-profile-card'}
      title={name}
    >
      {title && (
        <ProfileHoverCardRow icon={BriefcaseBusiness} label={t('memberProfile.jobTitle')}>
          <Text ellipsis>{title}</Text>
        </ProfileHoverCardRow>
      )}
      {responsibilities && (
        <ProfileHoverCardRow icon={ListChecks} label={t('memberProfile.responsibilities')}>
          <div style={CLAMPED_TEXT} title={responsibilities}>
            {responsibilities}
          </div>
        </ProfileHoverCardRow>
      )}
      {email && (
        <ProfileHoverCardRow icon={Mail} label={t('memberProfile.email')}>
          <Text ellipsis>{email}</Text>
        </ProfileHoverCardRow>
      )}
    </ProfileHoverCard>
  );
});

MemberProfileCard.displayName = 'MemberProfileCard';

export default MemberProfileCard;
