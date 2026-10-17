'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import {
  ActionIcon,
  Avatar,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Popover,
  Skeleton,
  Text,
  toast,
} from '@lobehub/ui';
import { ChevronDownIcon, LockIcon, RefreshCwIcon, UsersIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RetainedMemberDrives from '@/business/client/features/RetainedMemberDrives';
import { formatSize } from '@/utils/format';

import { useDriveUsage } from './useDriveData';

const styles = createStaticStyles(({ css }) => ({
  // A track that reads as one even when nearly empty, and a fill that never
  // shrinks below a sliver — "almost nothing used" still shows as a start.
  meter: css`
    overflow: hidden;
    display: inline-flex;
    flex: none;

    width: 72px;
    height: 4px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  meterFill: css`
    min-width: 4px;
    height: 100%;
    border-radius: 2px;
  `,
  line: css`
    min-height: 28px;
  `,
  trigger: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 8px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    background: none;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
    }
  `,
}));

const percentOf = (bytes: number | null | undefined, quota: number) =>
  quota > 0 && bytes ? Math.min(100, (bytes / quota) * 100) : 0;

type DriveUsageData = NonNullable<ReturnType<typeof useDriveUsage>['data']>;

/**
 * Where the pool goes: the total against the plan, each of the caller's
 * drives, then — for an owner or admin — each member's personal drive, how
 * much and never what. One component for both places it is read — the
 * storage page's meter opens it, the billing usage page embeds it — so the two
 * never disagree on a figure.
 */
export const DriveUsageBreakdown = memo<{
  data: DriveUsageData;
  /** In a popover: bounded width. Embedded in a page: the page's width. */
  inPopover?: boolean;
  onRefresh: () => Promise<void>;
}>(({ data, inPopover, onRefresh }) => {
  const { t } = useTranslation('setting');
  const [refreshing, setRefreshing] = useState(false);
  const drives = data.drives ?? [];
  const members = data.members ?? [];
  const isWorkspace = drives.length > 1;
  const { quotaBytes, totalUsageBytes } = data;
  const over = totalUsageBytes !== null && totalUsageBytes > quotaBytes;

  return (
    <Flexbox
      gap={12}
      style={inPopover ? { maxWidth: 'min(360px, 80vw)', minWidth: 280 } : undefined}
    >
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox gap={6} style={{ minWidth: 0 }}>
          <Text weight={500}>{t(isWorkspace ? 'drive.usage.poolTitle' : 'drive.usage.title')}</Text>
          <Flexbox horizontal align={'center'} gap={8}>
            <span className={styles.meter} style={{ width: inPopover ? 96 : 160 }}>
              <span
                className={styles.meterFill}
                style={{
                  background: over ? cssVar.colorError : cssVar.colorPrimary,
                  width: `${percentOf(totalUsageBytes, quotaBytes)}%`,
                }}
              />
            </span>
            <Text fontSize={12} type={over ? 'danger' : 'secondary'}>
              {totalUsageBytes === null
                ? t('drive.usage.unmeasured', { total: formatSize(quotaBytes) })
                : t('drive.usage.used', {
                    total: formatSize(quotaBytes),
                    used: formatSize(totalUsageBytes),
                  })}
            </Text>
          </Flexbox>
        </Flexbox>
        <ActionIcon
          icon={RefreshCwIcon}
          loading={refreshing}
          size={'small'}
          title={t('drive.usage.refresh')}
          onClick={async () => {
            setRefreshing(true);
            try {
              await onRefresh();
            } catch {
              toast.error(t('workingDirectory.drive.actionFailed', { ns: 'device' }));
            } finally {
              setRefreshing(false);
            }
          }}
        />
      </Flexbox>

      <Flexbox gap={2}>
        {drives.map((entry) => (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.line}
            gap={8}
            justify={'space-between'}
            key={entry.drive}
          >
            <Flexbox horizontal align={'center'} gap={8}>
              <Icon
                icon={entry.drive === 'public' ? UsersIcon : LockIcon}
                size={14}
                style={{ color: cssVar.colorTextTertiary }}
              />
              <Text fontSize={13}>{t(`drive.tabs.${entry.drive as SandboxDrive}`)}</Text>
            </Flexbox>
            <Text fontSize={13} type={'secondary'}>
              {entry.usageBytes === null ? '—' : formatSize(entry.usageBytes)}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>

      {members.length > 0 && (
        <Flexbox gap={2}>
          <Text fontSize={12} type={'secondary'}>
            {t('drive.usage.membersTitle')}
          </Text>
          {members.map((member) => (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.line}
              gap={8}
              justify={'space-between'}
              key={member.userId}
            >
              <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                <Avatar avatar={member.avatar || member.name || member.userId} size={20} />
                <Text ellipsis fontSize={13}>
                  {member.name || member.userId}
                </Text>
              </Flexbox>
              <Text fontSize={13} style={{ flex: 'none' }} type={'secondary'}>
                {member.usageBytes === null
                  ? t('drive.usage.memberUnmeasured')
                  : formatSize(member.usageBytes)}
              </Text>
            </Flexbox>
          ))}
          <Text fontSize={12} type={'secondary'}>
            {t('drive.usage.membersHint')}
          </Text>
        </Flexbox>
      )}

      {isWorkspace && <RetainedMemberDrives />}

      {over && (
        <Text fontSize={12} type={'danger'}>
          {t('drive.usage.over')}
        </Text>
      )}
    </Flexbox>
  );
});

DriveUsageBreakdown.displayName = 'DriveUsageBreakdown';

/**
 * How full the plan's storage is, as one compact meter in the page header.
 *
 * The storage page is for the folders on a drive; how much they hold is
 * second to that, so the figure takes a line's worth of room and the
 * breakdown — each drive, each member's for an admin, departed members'
 * drives — opens from it on demand. Over the quota it turns red, because then
 * the next write is refused and the figure stops being secondary.
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

  return (
    <Popover
      content={<DriveUsageBreakdown inPopover data={data} onRefresh={refresh} />}
      placement={'bottomRight'}
      trigger={'click'}
    >
      <Flexbox
        horizontal
        align={'center'}
        aria-label={t(isWorkspace ? 'drive.usage.poolTitle' : 'drive.usage.title')}
        as={'button'}
        className={styles.trigger}
        gap={8}
      >
        <span className={styles.meter}>
          <span
            className={styles.meterFill}
            style={{
              background: over ? cssVar.colorError : cssVar.colorPrimary,
              width: `${percentOf(totalUsageBytes, quotaBytes)}%`,
            }}
          />
        </span>
        <Text fontSize={12} style={{ whiteSpace: 'nowrap' }} type={over ? 'danger' : 'secondary'}>
          {totalUsageBytes === null
            ? t('drive.usage.unmeasured', { total: formatSize(quotaBytes) })
            : t('drive.usage.used', {
                total: formatSize(quotaBytes),
                used: formatSize(totalUsageBytes),
              })}
        </Text>
        <Icon icon={ChevronDownIcon} size={12} style={{ color: cssVar.colorTextTertiary }} />
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

  return <DriveUsageBreakdown data={data} onRefresh={refresh} />;
});

DriveUsageCard.displayName = 'DriveUsageCard';
