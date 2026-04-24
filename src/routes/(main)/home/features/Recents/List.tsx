import { Flexbox } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import AllRecentsDrawer from './AllRecentsDrawer';
import RecentListItem from './Item';

const RecentsList = memo(() => {
  const { t } = useTranslation('chat');
  const recents = useHomeStore(homeRecentSelectors.recents);
  const isInit = useHomeStore(homeRecentSelectors.isRecentsInit);
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);
  const [drawerOpen, openDrawer, closeDrawer] = useHomeStore((s) => [
    s.allRecentsDrawerOpen,
    s.openAllRecentsDrawer,
    s.closeAllRecentsDrawer,
  ]);

  const filteredRecents = useMemo(
    () => (enableAgentTask ? recents : recents.filter((item) => item.type !== 'task')),
    [recents, enableAgentTask],
  );
  const displayItems = useMemo(
    () => filteredRecents.slice(0, recentPageSize),
    [filteredRecents, recentPageSize],
  );
  const hasMore = filteredRecents.length > recentPageSize;

  const getRecentRoute = useCallback((item: (typeof displayItems)[number]) => {
    if (item.type !== 'task') return item.routePath;
    const taskId = item.id;
    if (!taskId) return item.routePath;

    return `/task/${taskId}`;
  }, []);

  if (!isInit) {
    return <SkeletonList rows={3} />;
  }

  return (
    <Flexbox gap={2}>
      {displayItems.map((item) => (
        <Link
          key={`${item.type}-${item.id}`}
          style={{ color: 'inherit', textDecoration: 'none' }}
          to={getRecentRoute(item)}
        >
          <RecentListItem {...item} />
        </Link>
      ))}
      {hasMore && (
        <NavItem icon={MoreHorizontalIcon} title={t('input.more')} onClick={openDrawer} />
      )}
      <AllRecentsDrawer open={drawerOpen} onClose={closeDrawer} />
    </Flexbox>
  );
});

export default RecentsList;
