import { createStaticStyles, cssVar, cx, Flexbox, Icon, Tooltip } from '@lobehub/ui';
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

import {
  getProjectTopicStatusCounts,
  hasProjectTopicStatusCounts,
  type ProjectTopicStatusCounts,
} from './statusCounts';

export const indicatorStyles = createStaticStyles(({ css }) => ({
  statusBadge: css`
    display: inline-flex;
    gap: 2px;
    align-items: center;
    justify-content: center;

    min-width: 20px;
    height: 18px;
    padding-inline: 4px;
    border-radius: 9px;

    font-size: 11px;
    font-weight: 500;
    line-height: 1;
  `,
  statusBadgeError: css`
    color: ${cssVar.colorError};
    background: color-mix(in srgb, ${cssVar.colorError} 14%, transparent);
  `,
  statusBadgeLoading: css`
    color: ${cssVar.colorWarning};
    background: color-mix(in srgb, ${cssVar.colorWarning} 14%, transparent);
  `,
  statusBadgeWaiting: css`
    color: ${cssVar.colorInfo};
    background: color-mix(in srgb, ${cssVar.colorInfo} 14%, transparent);
  `,
  hoverActions: css`
    pointer-events: none;

    overflow: hidden;
    display: inline-flex;
    flex: none;
    align-items: center;

    max-width: 0;

    opacity: 0;

    transition:
      max-width 150ms ${cssVar.motionEaseOut},
      opacity 150ms ${cssVar.motionEaseOut};

    /* Holds up to the grouping menu, the "more" menu and the start "+"
       (3 × 24px). Stays open while one of its menus is, so the popup keeps
       its anchor. */
    &:focus-within,
    &:has([data-popup-open]),
    .accordion-header:hover & {
      pointer-events: auto;
      max-width: 72px;
      opacity: 1;
    }

    /* Touch-only screens have no hover to reveal the actions with, so they
       keep their width there, as before the actions collapsed at rest. */
    @media (hover: none) {
      pointer-events: auto;
      max-width: 72px;
      opacity: 1;
    }
  `,
}));

interface StatusBadgeConfig {
  className: string;
  count: number;
  icon?: LucideIcon;
  label: string;
  loading?: boolean;
}

const CollapsedStatusBadges = memo<{ counts: ProjectTopicStatusCounts }>(({ counts }) => {
  const { t } = useTranslation('topic');

  const items: StatusBadgeConfig[] = [
    {
      className: indicatorStyles.statusBadgeLoading,
      count: counts.loading,
      label: t('projectStatus.loading', { count: counts.loading }),
      loading: true,
    },
    {
      className: indicatorStyles.statusBadgeWaiting,
      count: counts.waitingForHuman,
      icon: TOPIC_STATUS_VISUALS.waitingForHuman.icon,
      label: t('projectStatus.waitingForHuman', { count: counts.waitingForHuman }),
    },
    {
      className: indicatorStyles.statusBadgeError,
      count: counts.failed,
      icon: TOPIC_STATUS_VISUALS.failed.icon,
      label: t('projectStatus.failed', { count: counts.failed }),
    },
  ].filter((item) => item.count > 0);

  if (items.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} gap={3}>
      {items.map(({ className, count, icon, label, loading }) => (
        <Tooltip key={label} title={label}>
          <span
            aria-label={label}
            className={cx(indicatorStyles.statusBadge, className)}
            role="status"
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
