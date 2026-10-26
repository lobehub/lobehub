'use client';

import { ActionIcon, Avatar, Button, Flexbox, Icon, Text, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { LockIcon, RefreshCwIcon, UserRoundIcon, UsersIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RetainedMemberDrives from '@/business/client/features/RetainedMemberDrives';
import SandboxStorageOverQuotaAction from '@/business/client/features/SandboxStorageOverQuotaAction';
import { formatSize } from '@/utils/format';

import type { useDriveUsage } from './useDriveData';

type DriveUsageData = NonNullable<ReturnType<typeof useDriveUsage>['data']>;

/** How many members the ranking shows before it folds the rest away. */
const MEMBERS_FOLDED = 5;

const styles = stylex.create({
  // One bar for the whole quota; each drive is a segment of it. The 2px gap in
  // the surface colour is what separates segments — never a stroke.
  bar: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 4,
    display: 'flex',
    gap: 2,
    height: 8,
    width: '100%',
  },
  dot: {
    borderRadius: '50%',
    flex: 'none',
    height: 8,
    width: 8,
  },
  legendIcon: {
    color: cssVar.colorTextTertiary,
  },
  memberBar: {
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: 2,
    flex: 'none',
    height: 4,
    overflow: 'hidden',
    width: 96,
  },
  memberFill: {
    backgroundColor: cssVar.colorTextSecondary,
    borderRadius: 2,
    display: 'block',
    height: '100%',
  },
  memberSize: {
    flex: 'none',
    textAlign: 'end',
    width: 72,
  },
  popover: {
    maxWidth: 'min(380px, 80vw)',
    minWidth: 300,
  },
  row: {
    minHeight: 32,
  },
  segment: {
    borderEndEndRadius: { 'default': null, ':last-child': 4 },
    borderEndStartRadius: { 'default': null, ':first-child': 4 },
    borderStartEndRadius: { 'default': null, ':last-child': 4 },
    borderStartStartRadius: { 'default': null, ':first-child': 4 },
    flex: 'none',
    height: '100%',
    minWidth: 4,
  },
  shrinkable: {
    minWidth: 0,
  },
  width: (width: string) => ({ width }),
});

/**
 * Each segment's colour. Two hues carry the caller's drives (validated for
 * colour-blind separation); other members are the de-emphasised grey; over
 * the quota everything is the danger colour.
 */
const tones = stylex.create({
  others: { backgroundColor: cssVar.colorTextQuaternary },
  over: { backgroundColor: cssVar.colorError },
  personal: { backgroundColor: cssVar.purple },
  public: { backgroundColor: cssVar.geekblue },
});

interface Segment {
  bytes: number;
  icon: LucideIcon;
  key: 'others' | 'personal' | 'public';
  label: string;
}

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.min(100, (part / whole) * 100) : 0;

/** Whole percents, but never "0%" for something that is there. */
const formatPercent = (value: number) =>
  value > 0 && value < 1 ? '<1' : String(Math.round(value));

/**
 * Where a drive pool goes, laid out the way consumer drives do it (Google
 * Drive, iCloud, Dropbox): the amount used as the figure you read first, the
 * room left beside it, one bar split by what fills it, a legend that names
 * every segment with its size, then — for an owner or admin — the members,
 * largest first.
 *
 * The segments are the caller's two drives and "other members", the rest of
 * the pool. Two hues carry the drives (validated for colour-blind separation;
 * the legend icons and values carry identity as well, never colour alone);
 * other members are the de-emphasised grey, because the caller acts on their
 * own drives and only reads the rest. Over a quota the plan does not bill past,
 * every segment turns to the danger colour, because then the bar's message is
 * "writes are refused", not "this is how it splits"; with pay-as-you-go the
 * split stays and the figures say it is being billed.
 */
export const UsageBreakdown = memo<{
  data: DriveUsageData;
  /** In a popover: a smaller figure and bounded width. Embedded: the page's width. */
  inPopover?: boolean;
  onRefresh: () => Promise<void>;
}>(({ data, inPopover, onRefresh }) => {
  const { t } = useTranslation('setting');
  const [refreshing, setRefreshing] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);

  const drives = data.drives ?? [];
  const members = [...(data.members ?? [])].sort(
    (a, b) => (b.usageBytes ?? -1) - (a.usageBytes ?? -1),
  );
  const isWorkspace = drives.length > 1;
  const { quotaBytes } = data;

  const bytesOf = (drive: 'public' | 'personal') =>
    drives.find((entry) => entry.drive === drive)?.usageBytes ?? 0;
  const publicBytes = isWorkspace ? bytesOf('public') : 0;
  const personalBytes = bytesOf('personal');
  const known = publicBytes + personalBytes;
  const total = data.totalUsageBytes ?? (drives.some((d) => d.usageBytes !== null) ? known : null);
  // The pool total is the execution plane's own figure; whatever it holds
  // beyond the caller's drives is other members'.
  const othersBytes = isWorkspace && total !== null ? Math.max(0, total - known) : 0;
  const over = total !== null && total > quotaBytes;
  // Over the quota is only a refusal when the plan cannot bill the overage;
  // with pay-as-you-go the writes go on and the extra is charged.
  const refused = over && !data.overageAllowed;
  const scale = Math.max(quotaBytes, total ?? 0);

  const segments: Segment[] = (
    [
      isWorkspace && {
        bytes: publicBytes,
        icon: UsersIcon,
        key: 'public',
        label: t('drive.tabs.public'),
      },
      {
        bytes: personalBytes,
        icon: LockIcon,
        key: 'personal',
        label: t('drive.tabs.personal'),
      },
      isWorkspace && {
        bytes: othersBytes,
        icon: UserRoundIcon,
        key: 'others',
        label: t('drive.usage.others'),
      },
    ] as (Segment | false)[]
  ).filter((segment): segment is Segment => !!segment);

  const visibleMembers = showAllMembers ? members : members.slice(0, MEMBERS_FOLDED);
  const largestMember = Math.max(1, ...members.map((member) => member.usageBytes ?? 0));

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      toast.error(t('workingDirectory.drive.actionFailed', { ns: 'device' }));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Flexbox className={inPopover ? stylex.props(styles.popover).className : undefined} gap={16}>
      {/* The figure first: how much is used, against how much there is. */}
      <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
        <Flexbox className={stylex.props(styles.shrinkable).className} gap={4}>
          <Text fontSize={12} type={'secondary'}>
            {t(isWorkspace ? 'drive.usage.poolTitle' : 'drive.usage.title')}
          </Text>
          <Flexbox horizontal align={'baseline'} gap={6} wrap={'wrap'}>
            <Text
              fontSize={inPopover ? 20 : 24}
              type={refused ? 'danger' : over ? 'warning' : undefined}
              weight={600}
            >
              {total === null ? '—' : formatSize(total)}
            </Text>
            <Text fontSize={13} type={'secondary'}>
              / {formatSize(quotaBytes)}
            </Text>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={4}>
          <Text fontSize={12} type={refused ? 'danger' : over ? 'warning' : 'secondary'}>
            {total === null
              ? t('drive.usage.unmeasuredShort')
              : over
                ? t('drive.usage.overBy', { size: formatSize(total - quotaBytes) })
                : t('drive.usage.remaining', {
                    percent: formatPercent(percent(total, quotaBytes)),
                    size: formatSize(quotaBytes - total),
                  })}
          </Text>
          <ActionIcon
            icon={RefreshCwIcon}
            loading={refreshing}
            size={'small'}
            title={t('drive.usage.refresh')}
            onClick={refresh}
          />
        </Flexbox>
      </Flexbox>

      <div
        aria-label={t(isWorkspace ? 'drive.usage.poolTitle' : 'drive.usage.title')}
        role={'img'}
        {...stylex.props(styles.bar)}
      >
        {segments
          .filter((segment) => segment.bytes > 0)
          .map((segment) => (
            <Tooltip
              key={segment.key}
              title={`${segment.label} · ${formatSize(segment.bytes)} · ${formatPercent(
                percent(segment.bytes, quotaBytes),
              )}%`}
            >
              <span
                {...stylex.props(
                  styles.segment,
                  tones[refused ? 'over' : segment.key],
                  styles.width(`${percent(segment.bytes, scale)}%`),
                )}
              />
            </Tooltip>
          ))}
      </div>

      {/* A legend whenever there is more than one segment: icon, name and size
          name each one, so the split never rests on colour alone. */}
      {segments.length > 1 &&
        (inPopover ? (
          // Narrow: one row per segment, sizes aligned on the right.
          <Flexbox gap={2}>
            {segments.map((segment) => (
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.row).className}
                gap={8}
                justify={'space-between'}
                key={segment.key}
              >
                <Flexbox horizontal align={'center'} gap={8}>
                  <span {...stylex.props(styles.dot, tones[segment.key])} />
                  <Icon
                    className={stylex.props(styles.legendIcon).className}
                    icon={segment.icon}
                    size={13}
                  />
                  <Text fontSize={13}>{segment.label}</Text>
                </Flexbox>
                <Text fontSize={13} type={'secondary'}>
                  {formatSize(segment.bytes)}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        ) : (
          <Flexbox horizontal style={{ columnGap: 20, rowGap: 8 }} wrap={'wrap'}>
            {segments.map((segment) => (
              <Flexbox horizontal align={'center'} gap={6} key={segment.key}>
                <span {...stylex.props(styles.dot, tones[segment.key])} />
                <Icon
                  className={stylex.props(styles.legendIcon).className}
                  icon={segment.icon}
                  size={13}
                />
                <Text fontSize={13}>{segment.label}</Text>
                <Text fontSize={13} type={'secondary'}>
                  {formatSize(segment.bytes)}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        ))}

      {members.length > 0 && (
        <Flexbox gap={4}>
          <Flexbox horizontal align={'baseline'} gap={8} justify={'space-between'}>
            <Text fontSize={12} type={'secondary'} weight={500}>
              {t('drive.usage.membersTitle')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('drive.usage.membersHint')}
            </Text>
          </Flexbox>
          {visibleMembers.map((member) => (
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.row).className}
              gap={12}
              key={member.userId}
            >
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.shrinkable).className}
                flex={1}
                gap={8}
              >
                <Avatar avatar={member.avatar || member.name || member.userId} size={22} />
                <Text ellipsis fontSize={13}>
                  {member.name || member.userId}
                </Text>
              </Flexbox>
              {/* Relative to the largest member, so the ranking reads at a glance. */}
              <span {...stylex.props(styles.memberBar)}>
                <span
                  {...stylex.props(
                    styles.memberFill,
                    styles.width(`${percent(member.usageBytes ?? 0, largestMember)}%`),
                  )}
                />
              </span>
              <Text
                className={stylex.props(styles.memberSize).className}
                fontSize={13}
                type={'secondary'}
              >
                {member.usageBytes === null
                  ? t('drive.usage.memberUnmeasured')
                  : formatSize(member.usageBytes)}
              </Text>
            </Flexbox>
          ))}
          {members.length > MEMBERS_FOLDED && (
            <Button
              size={'small'}
              style={{ alignSelf: 'flex-start' }}
              type={'text'}
              onClick={() => setShowAllMembers((value) => !value)}
            >
              {showAllMembers
                ? t('drive.usage.showFewerMembers')
                : t('drive.usage.showAllMembers', { count: members.length })}
            </Button>
          )}
        </Flexbox>
      )}

      {isWorkspace && <RetainedMemberDrives />}

      {over && (
        <Text fontSize={12} type={refused ? 'danger' : 'warning'}>
          {t(refused ? 'drive.usage.over' : 'drive.usage.overBilled')}
        </Text>
      )}
      {/* While writes are refused, the way to keep saving — not only the fact. */}
      {refused && <SandboxStorageOverQuotaAction />}
    </Flexbox>
  );
});

UsageBreakdown.displayName = 'UsageBreakdown';
