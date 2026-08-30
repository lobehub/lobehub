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
  const refs = useHomeStore(homeRecentSelectors.refs(scope));
  const isInit = useHomeStore(homeRecentSelectors.isRecentsInit(scope));
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);
  const [drawerOpen, openDrawer, closeDrawer] = useHomeStore((s) => [
    s.allRecentsDrawerOpen,
    s.openAllRecentsDrawer,
    s.closeAllRecentsDrawer,
  ]);

  const displayRefs = useMemo(() => refs.slice(0, recentPageSize), [refs, recentPageSize]);
  const hasMore = refs.length > recentPageSize;

  // Error gated ahead of the skeleton so a failed recents fetch shows Retry
  // instead of a permanent skeleton (`isRecentsInit` only flips on success —
  //
  return (
    <AsyncBoundary
      data={isInit ? refs : undefined}
      error={isInit ? undefined : error}
      errorVariant={'inline'}
      isLoading={!isInit && !error}
      loading={<SkeletonList rows={3} />}
      onRetry={onRetry}
    >
      <Flexbox gap={1}>
        {displayRefs.map((ref) => (
          <ConnectedItem entityRef={ref} key={ref} scope={scope} />
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
