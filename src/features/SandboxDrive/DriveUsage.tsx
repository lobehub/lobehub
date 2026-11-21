'use client';

import { Flexbox, Icon, Popover, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { UsageBreakdown } from './UsageBreakdown';
import { useDriveUsage } from './useDriveData';

export { UsageBreakdown as DriveUsageBreakdown } from './UsageBreakdown';

const styles = stylex.create({
  chevron: {
    color: cssVar.colorTextTertiary,
  },
  // A track that reads as one even when nearly empty, and a fill that never
  // shrinks below a sliver — "almost nothing used" still shows as a start.
  meter: {
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: 2,
    display: 'inline-flex',
    flex: 'none',
    height: 4,
    overflow: 'hidden',
    width: 72,
  },
  meterFill: {
    backgroundColor: cssVar.colorPrimary,
    borderRadius: 2,
    height: '100%',
    minWidth: 4,
  },
  meterFillBilled: {
    backgroundColor: cssVar.colorWarning,
  },
  meterFillOver: {
    backgroundColor: cssVar.colorError,
  },
  meterWidth: (width: string) => ({ width }),
  trigger: {
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    borderRadius: cssVar.borderRadius,
    borderStyle: 'none',
    cursor: 'pointer',
    outline: { 'default': null, ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}` },
    paddingBlock: 4,
    paddingInline: 8,
  },
});

const percentOf = (bytes: number | null | undefined, quota: number) =>
  quota > 0 && bytes ? Math.min(100, (bytes / quota) * 100) : 0;

/**
 * How full the plan's storage is, as one compact meter in the page header.
 *
 * The storage page is for the folders on a drive; how much they hold is
 * second to that, so the figure takes a line's worth of room and the
 * breakdown — each drive, each member's for an admin, departed members'
 * drives — opens from it on demand. Over a quota the plan cannot bill past it
 * turns red, because then the next write is refused and the figure stops
 * being secondary; billed overage reads as a warning instead.
 *
 * Read from what was last measured; measuring walks the volume, so it waits
 * for the refresh in the breakdown.
 */
const DriveUsage = memo(() => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading, refresh } = useDriveUsage();

  if (error) return null;
  if (isLoading || !data) return <Skeleton.Text rows={1} width={160} />;

  const { quotaBytes, totalUsageBytes } = data;
  const isWorkspace = (data.drives ?? []).length > 1;
  const over = totalUsageBytes !== null && totalUsageBytes > quotaBytes;
  const refused = over && !data.overageAllowed;

  return (
    <Popover
      content={<UsageBreakdown inPopover data={data} onRefresh={refresh} />}
      placement={'bottomRight'}
      trigger={'click'}
    >
      <Flexbox
        horizontal
        align={'center'}
        aria-label={t(isWorkspace ? 'drive.usage.poolTitle' : 'drive.usage.title')}
        as={'button'}
        className={stylex.props(styles.trigger).className}
        gap={8}
      >
        <span {...stylex.props(styles.meter)}>
          <span
            {...stylex.props(
              styles.meterFill,
              over && (refused ? styles.meterFillOver : styles.meterFillBilled),
              styles.meterWidth(`${percentOf(totalUsageBytes, quotaBytes)}%`),
            )}
          />
        </span>
        <Text
          fontSize={12}
          style={{ whiteSpace: 'nowrap' }}
          type={refused ? 'danger' : over ? 'warning' : 'secondary'}
        >
          {totalUsageBytes === null
            ? t('drive.usage.unmeasured', { total: formatSize(quotaBytes) })
            : t('drive.usage.used', {
                total: formatSize(quotaBytes),
                used: formatSize(totalUsageBytes),
              })}
        </Text>
        <Icon className={stylex.props(styles.chevron).className} icon={ChevronDownIcon} size={12} />
      </Flexbox>
    </Popover>
  );
});

DriveUsage.displayName = 'DriveUsage';

export default DriveUsage;

/**
 * The breakdown on its own, for a page that shows usage as a section of its
 * own — the billing usage page — rather than as a meter beside something else.
 * Nothing while loading or when there is no drive to break down.
 */
export const DriveUsageCard = memo(() => {
  const { data, error, refresh } = useDriveUsage();
  if (error || !data) return null;

  return <UsageBreakdown data={data} onRefresh={refresh} />;
});

DriveUsageCard.displayName = 'DriveUsageCard';
