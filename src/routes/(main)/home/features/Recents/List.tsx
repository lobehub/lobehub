import { Flexbox } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';

import AllRecentsDrawer from './AllRecentsDrawer';
import RecentListItem from './Item';

interface RecentsListProps {
  /** Thrown error from the recents SWR — surfaced as a failure state. */
  error?: unknown;
  onRetry?: () => void;
}

const RecentsList = memo<RecentsListProps>(({ error, onRetry }) => {
  const { t } = useTranslation('chat');
  const recents = useHomeStore(homeRecentSelectors.recents);
  const isInit = useHomeStore(homeRecentSelectors.isRecentsInit);
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);
  const [drawerOpen, openDrawer, closeDrawer] = useHomeStore((s) => [
    s.allRecentsDrawerOpen,
    s.openAllRecentsDrawer,
    s.closeAllRecentsDrawer,
  ]);

  const displayItems = useMemo(() => recents.slice(0, recentPageSize), [recents, recentPageSize]);
  const hasMore = recents.length > recentPageSize;

  const getRecentRoute = useCallback((item: (typeof displayItems)[number]) => {
    if (item.type !== 'task') return item.routePath;
    const taskId = item.id;
    if (!taskId) return item.routePath;

    return taskDetailPath(taskId, item.agentId ?? undefined);
  }, []);

  // Error gated ahead of the skeleton so a failed recents fetch shows Retry
  // instead of a permanent skeleton (`isRecentsInit` only flips on success —
  // LOBE-11079).
  return (
    <AsyncBoundary
      data={isInit ? recents : undefined}
      error={error}
      errorVariant={'inline'}
      isLoading={!isInit && !error}
      loading={<SkeletonList rows={3} />}
      onRetry={onRetry}
    >
      <Flexbox gap={1}>
        {displayItems.map((item) => (
          <WorkspaceLink
            key={`${item.type}-${item.id}`}
            style={{ color: 'inherit', textDecoration: 'none' }}
            to={getRecentRoute(item)}
          >
            <RecentListItem {...item} />
          </WorkspaceLink>
        ))}
        {hasMore && (
          <NavItem icon={MoreHorizontalIcon} title={t('input.more')} onClick={openDrawer} />
        )}
        <AllRecentsDrawer open={drawerOpen} onClose={closeDrawer} />
      </Flexbox>
    </AsyncBoundary>
  );
});

export default RecentsList;
