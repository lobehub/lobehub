'use client';

import type { DeviceEnroller } from '@lobechat/types';
import { createStaticStyles, cssVar, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';

/** Same cadence as the detail page, so a card and its detail agree on what is running. */
const REFRESH_INTERVAL_MS = 15_000;
/** Past this the stack turns into a smudge; the rest are counted instead. */
const MAX_STACKED = 4;

const styles = createStaticStyles(({ css }) => ({
  overflowCount: css`
    flex: none;
    margin-inline-start: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  stack: css`
    /* Overlap the stack so N members read as one cluster, not a toolbar. */
    > *:not(:first-child) {
      margin-inline-start: -6px;
    }
  `,
  // Ring in the card's own background so overlapping avatars stay separable.
  stacked: css`
    flex: none;
    box-shadow: 0 0 0 2px ${cssVar.colorBgContainer};
  `,
}));

const userName = (user: DeviceEnroller) => user.fullName || user.username || '';

/** The member who started a run, named on hover. */
export const RunUserAvatar = memo<{ className?: string; size?: number; user: DeviceEnroller }>(
  ({ className, size = 20, user }) => (
    <Tooltip title={userName(user)}>
      <UserAvatar
        avatar={user.avatar}
        className={className}
        name={userName(user)}
        shape={'circle'}
        size={size}
        style={{ flex: 'none' }}
      />
    </Tooltip>
  ),
);

RunUserAvatar.displayName = 'RunUserAvatar';

/**
 * Running-topic counts for every device in the list, from one request. Keyed
 * per workspace by `useClientDataSWR`, like the device list itself.
 */
export const useDeviceRunningSummary = () =>
  useClientDataSWR(['device/runningSummary'], () => deviceService.getRunningSummary(), {
    focusThrottleInterval: 1000,
    refreshInterval: REFRESH_INTERVAL_MS,
  });

/**
 * How many topics a device is running and whose they are — the card-sized
 * answer to "is anyone using this machine right now?".
 */
export const DeviceRunningSummaryValue = memo<{ deviceId: string }>(({ deviceId }) => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading } = useDeviceRunningSummary();

  if (isLoading) return <Text type={'secondary'}>…</Text>;
  // A failed read must not pass for an idle machine — "—" means nothing runs.
  if (error && !data)
    return (
      <Tooltip title={t('devices.activity.error')}>
        <Icon
          aria-label={t('devices.activity.error')}
          color={cssVar.colorWarning}
          icon={TriangleAlertIcon}
          size={14}
        />
      </Tooltip>
    );

  const summary = data?.find((entry) => entry.deviceId === deviceId);
  if (!summary || summary.count === 0) return <Text type={'secondary'}>—</Text>;

  // A server that predates per-user attribution sends no `users`.
  const users = summary.users ?? [];
  const shown = users.slice(0, MAX_STACKED);
  const overflow = users.length - shown.length;

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <RunningGlyph size={14} />
      <Text fontSize={13} style={{ flex: 'none' }}>
        {summary.count}
      </Text>
      <Flexbox horizontal align={'center'} className={styles.stack}>
        {shown.map((user) => (
          <RunUserAvatar className={styles.stacked} key={user.userId} size={18} user={user} />
        ))}
        {overflow > 0 && <span className={styles.overflowCount}>+{overflow}</span>}
      </Flexbox>
    </Flexbox>
  );
});

DeviceRunningSummaryValue.displayName = 'DeviceRunningSummaryValue';
