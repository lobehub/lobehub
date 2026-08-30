import { Flexbox } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';
import { createRecentQueryKey } from '@/store/home/slices/recent/initialState';

import AllRecentsDrawer from './AllRecentsDrawer';
import ConnectedItem from './ConnectedItem';

interface RecentsListProps {
  /** Thrown error from the recents SWR — surfaced as a failure state. */
  error?: unknown;
  onRetry?: () => void;
  scope: string;
}

const RecentsList = memo<RecentsListProps>(({ error, onRetry, scope }) => {
  const { t } = useTranslation('chat');
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);
  const queryKey = createRecentQueryKey(recentPageSize + 1);
  const query = useHomeStore(homeRecentSelectors.query(scope, queryKey));
  const items = query?.items;
  const [drawerOpen, openDrawer, closeDrawer] = useHomeStore((s) => [
    s.allRecentsDrawerOpen,
    s.openAllRecentsDrawer,
    s.closeAllRecentsDrawer,
  ]);

  const displayItems = useMemo(
    () => items?.slice(0, recentPageSize) ?? [],
    [items, recentPageSize],
  );
  const hasMore = (items?.length ?? 0) > recentPageSize;

  // Error gated ahead of the skeleton so a failed recents fetch shows Retry
  // instead of a permanent skeleton (`isRecentsInit` only flips on success —
  //
  return (
    <AsyncBoundary
      data={items}
      error={query ? undefined : error}
      errorVariant={'inline'}
      isLoading={!query && !error}
      loading={<SkeletonList rows={3} />}
      onRetry={onRetry}
    >
      <Flexbox gap={1}>
        {displayItems.map((item) => {
          const itemRef = `${item.type}:${item.id}` as const;
          return (
            <ConnectedItem itemRef={itemRef} key={itemRef} queryKey={queryKey} scope={scope} />
          );
        })}
        {hasMore && (
          <NavItem icon={MoreHorizontalIcon} title={t('input.more')} onClick={openDrawer} />
        )}
        <AllRecentsDrawer open={drawerOpen} onClose={closeDrawer} />
      </Flexbox>
    </AsyncBoundary>
  );
});

export default RecentsList;
