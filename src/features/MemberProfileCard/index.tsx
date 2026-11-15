'use client';

import { Center, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { BriefcaseBusiness, ListChecks, Mail } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';

import type { WorkspaceMemberProfile } from './useWorkspaceMemberProfile';

const KNOWN_ROLES = new Set(['admin', 'member', 'owner', 'viewer']);

const styles = stylex.create({
  avatar: {
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: cssVar.colorBgElevated,
  },
  banner: {
    position: 'relative',
    overflow: 'hidden',
    height: 60,
    backgroundColor: cssVar.colorFillTertiary,
  },
  bannerInner: {
    filter: 'blur(44px)',
  },
  body: {
    paddingBlock: 12,
    paddingInline: 16,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  container: {
    overflow: 'hidden',
    width: 280,
    backgroundColor: cssVar.colorBgElevated,
  },
  header: {
    position: 'relative',
    marginBlockStart: -24,
    paddingBlockEnd: 12,
    paddingInline: 16,
  },
  inherit: {
    color: 'inherit',
  },
  name: {
    fontSize: 16,
    fontWeight: 600,
    color: cssVar.colorText,
  },
  responsibilities: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 4,
    whiteSpace: 'pre-line',
  },
  row: {
    minWidth: 0,
    fontSize: 13,
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  rowIcon: {
    flex: 'none',
    height: 20,
    color: cssVar.colorTextTertiary,
  },
  rowValue: {
    flex: '1',
    minWidth: 0,
  },
});

const cls = (style: stylex.StyleXStyles) => stylex.props(style).className;

interface DetailRowProps {
  children: ReactNode;
  icon: LucideIcon;
  label: string;
}

const DetailRow = memo<DetailRowProps>(({ icon, label, children }) => (
  <Flexbox horizontal align={'flex-start'} aria-label={label} className={cls(styles.row)} gap={8}>
    <Center className={cls(styles.rowIcon)}>
      <Icon icon={icon} size={14} />
    </Center>
    <div {...stylex.props(styles.rowValue)}>{children}</div>
  </Flexbox>
));

DetailRow.displayName = 'MemberProfileDetailRow';

export interface MemberProfileCardProps {
  member: WorkspaceMemberProfile;
}

/**
 * A workspace member at a glance — who they are, their role in the workspace
 * and what they own — laid out like the Agent profile card so people and
 * Agents read as the same kind of teammate.
 */
const MemberProfileCard = memo<MemberProfileCardProps>(({ member }) => {
  const { t } = useTranslation(['chat', 'setting']);
  const { avatar, email, name, responsibilities, role, title, username } = member;

  const roleLabel =
    role && KNOWN_ROLES.has(role)
      ? t(`workspace.member.roles.${role}` as 'workspace.member.roles.member', { ns: 'setting' })
      : role;
  const handle = username && username !== name ? `@${username}` : undefined;
  const hasDetails = Boolean(title || responsibilities || email);

  return (
    <Flexbox className={cls(styles.container)} data-testid={'member-profile-card'}>
      <Center className={cls(styles.banner)}>
        <UserAvatar
          avatar={avatar}
          className={cls(styles.bannerInner)}
          name={name}
          shape={'square'}
          size={400}
        />
      </Center>

      <Flexbox className={cls(styles.header)} gap={8}>
        <UserAvatar
          avatar={avatar}
          className={cls(styles.avatar)}
          name={name}
          shape={'circle'}
          size={48}
        />
        <Flexbox gap={2}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text ellipsis className={cls(styles.name)}>
              {name}
            </Text>
            {roleLabel && (
              <Tag size={'small'} style={{ flex: 'none' }}>
                {roleLabel}
              </Tag>
            )}
          </Flexbox>
          {handle && (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {handle}
            </Text>
          )}
        </Flexbox>
      </Flexbox>

      {hasDetails && (
        <Flexbox className={cls(styles.body)} gap={8}>
          {title && (
            <DetailRow icon={BriefcaseBusiness} label={t('memberProfile.jobTitle')}>
              <Text ellipsis className={cls(styles.inherit)}>
                {title}
              </Text>
            </DetailRow>
          )}
          {responsibilities && (
            <DetailRow icon={ListChecks} label={t('memberProfile.responsibilities')}>
              <div {...stylex.props(styles.responsibilities)} title={responsibilities}>
                {responsibilities}
              </div>
            </DetailRow>
          )}
          {email && (
            <DetailRow icon={Mail} label={t('memberProfile.email')}>
              <Text ellipsis className={cls(styles.inherit)}>
                {email}
              </Text>
            </DetailRow>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

MemberProfileCard.displayName = 'MemberProfileCard';

export default MemberProfileCard;
