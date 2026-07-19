import { DEFAULT_USER_AVATAR_URL } from '@lobechat/const';
import { Avatar, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AlarmClockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';

const AVATAR_SIZE = 16;

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    flex: none;
  `,
  label: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
}));

interface AuthorChipProps {
  /** `topic.trigger` — a `cron` run has no human triggerer, only an owning schedule. */
  trigger?: string | null;
  /** `topic.userId` — the member who started (or owns) this run. */
  userId?: string;
}

/**
 * Who triggered a run, on the team view of a workspace inbox. A row the current
 * user didn't start needs a face to be legible — "whose is this?" is the first
 * question when the feed widens past your own work.
 *
 * A `cron`-triggered run has no person behind it, so it reads as a schedule
 * rather than borrowing its owner's face (which would imply they just ran it).
 */
const AuthorChip = memo<AuthorChipProps>(({ userId, trigger }) => {
  const { t } = useTranslation('home');
  const profiles = useWorkspaceMemberProfiles();

  if (trigger === 'cron')
    return (
      <Flexbox horizontal align={'center'} className={styles.chip} gap={4}>
        <Icon color={cssVar.colorTextQuaternary} icon={AlarmClockIcon} size={12} />
        <span className={styles.label}>{t('inbox.author.scheduled')}</span>
      </Flexbox>
    );

  const profile = userId ? profiles.get(userId) : undefined;
  if (!profile) return null;

  const name = profile.fullName || profile.username || '';

  return (
    <Flexbox horizontal align={'center'} className={styles.chip} gap={4}>
      <Tooltip title={name}>
        <Avatar
          avatar={profile.avatar || DEFAULT_USER_AVATAR_URL}
          shape={'circle'}
          size={AVATAR_SIZE}
        />
      </Tooltip>
      <Text ellipsis className={styles.label} style={{ maxWidth: 72 }}>
        {name}
      </Text>
    </Flexbox>
  );
});

export default AuthorChip;
