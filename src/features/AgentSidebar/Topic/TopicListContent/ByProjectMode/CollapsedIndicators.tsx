import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type StyleXStyles } from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { type LucideIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { TOPIC_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RingLoadingIcon from '@/components/RingLoading';
import UnreadDot from '@/components/UnreadDot';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { type ChatTopic } from '@/types/topic';

import { accordionHeaderMarker } from './markers.stylex';
import {
  getProjectTopicStatusCounts,
  hasProjectTopicStatusCounts,
  type ProjectTopicStatusCounts,
} from './statusCounts';

export const indicatorStyles = stylex.create({
  statusBadge: {
    display: 'inline-flex',
    gap: '2px',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '20px',
    height: '18px',
    paddingInline: '4px',
    borderRadius: '9px',
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: 1,
  },
  statusBadgeError: {
    color: cssVar.colorError,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorError} 14%, transparent)`,
    backgroundImage: 'none',
  },
  statusBadgeLoading: {
    color: cssVar.colorWarning,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorWarning} 14%, transparent)`,
    backgroundImage: 'none',
  },
  statusBadgeWaiting: {
    color: cssVar.colorInfo,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorInfo} 14%, transparent)`,
    backgroundImage: 'none',
  },
  // Holds up to the grouping menu, the "more" menu and the start "+"
  // (3 × 24px). Stays open while one of its menus is, so the popup keeps
  // its anchor. Touch-only screens have no hover to reveal the actions with,
  // so they keep their width there, as before the actions collapsed at rest.
  hoverActions: {
    pointerEvents: {
      'default': 'none',
      ':focus-within': 'auto',
      ':has([data-popup-open])': 'auto',
      [stylex.when.ancestor(':hover', accordionHeaderMarker)]: 'auto',
      '@media (hover: none)': 'auto',
    },
    overflow: 'hidden',
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    maxWidth: {
      'default': '0',
      ':focus-within': '72px',
      ':has([data-popup-open])': '72px',
      [stylex.when.ancestor(':hover', accordionHeaderMarker)]: '72px',
      '@media (hover: none)': '72px',
    },
    opacity: {
      'default': 0,
      ':focus-within': 1,
      ':has([data-popup-open])': 1,
      [stylex.when.ancestor(':hover', accordionHeaderMarker)]: 1,
      '@media (hover: none)': 1,
    },
    transition: `max-width 150ms ${cssVar.motionEaseOut}, opacity 150ms ${cssVar.motionEaseOut}`,
  },
});

interface StatusBadgeConfig {
  badgeStyle: StyleXStyles;
  count: number;
  icon?: LucideIcon;
  label: string;
  loading?: boolean;
}

const CollapsedStatusBadges = memo<{ counts: ProjectTopicStatusCounts }>(({ counts }) => {
  const { t } = useTranslation('topic');

  const items: StatusBadgeConfig[] = [
    {
      badgeStyle: indicatorStyles.statusBadgeLoading,
      count: counts.loading,
      label: t('projectStatus.loading', { count: counts.loading }),
      loading: true,
    },
    {
      badgeStyle: indicatorStyles.statusBadgeWaiting,
      count: counts.waitingForHuman,
      icon: TOPIC_STATUS_VISUALS.waitingForHuman.icon,
      label: t('projectStatus.waitingForHuman', { count: counts.waitingForHuman }),
    },
    {
      badgeStyle: indicatorStyles.statusBadgeError,
      count: counts.failed,
      icon: TOPIC_STATUS_VISUALS.failed.icon,
      label: t('projectStatus.failed', { count: counts.failed }),
    },
  ].filter((item) => item.count > 0);

  if (items.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} gap={3}>
      {items.map(({ badgeStyle, count, icon, label, loading }) => (
        <Tooltip key={label} title={label}>
          <span
            aria-label={label}
            role="status"
            {...stylex.props(indicatorStyles.statusBadge, badgeStyle)}
          >
            {loading ? (
              <RingLoadingIcon
                ringColor={`color-mix(in srgb, ${cssVar.colorWarning} 28%, transparent)`}
                size={11}
                style={{ color: cssVar.colorWarning }}
              />
            ) : (
              icon && <Icon icon={icon} size={{ size: 11, strokeWidth: 2 }} />
            )}
            {count}
          </span>
        </Tooltip>
      ))}
    </Flexbox>
  );
});

CollapsedStatusBadges.displayName = 'CollapsedProjectStatusBadges';

const CollapsedUnreadDot = memo<{ count: number }>(({ count }) => {
  const { t } = useTranslation('topic');
  const label = t('projectStatus.unread', { count });

  return (
    <Tooltip title={label}>
      <UnreadDot label={label} />
    </Tooltip>
  );
});

CollapsedUnreadDot.displayName = 'CollapsedProjectUnreadDot';

/**
 * Status counts (running / awaiting input / failed) and unread replies of a
 * folded group's topics, so a folded row still says how much is going on.
 * Nothing shows while the group is expanded — its topic rows say it already.
 */
export const useCollapsedIndicators = (topics: ChatTopic[], expanded: boolean) => {
  const statusCounts = useChatStore(
    (s) => getProjectTopicStatusCounts(topics, operationSelectors.visiblyRunningTopicIds(s)),
    isEqual,
  );
  const topicIds = useMemo(() => topics.map((topic) => topic.id), [topics]);
  const unreadCount = useChatStore(operationSelectors.unreadCompletedCountForTopics(topicIds));
  const hasStatus = !expanded && hasProjectTopicStatusCounts(statusCounts);
  const hasUnread = !expanded && unreadCount > 0;

  const indicators =
    hasStatus || hasUnread ? (
      <>
        {hasStatus && <CollapsedStatusBadges counts={statusCounts} />}
        {hasUnread && <CollapsedUnreadDot count={unreadCount} />}
      </>
    ) : null;

  return { hasIndicators: hasStatus || hasUnread, indicators };
};
