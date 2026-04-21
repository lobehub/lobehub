'use client';

import { Empty, Flexbox, SearchBar } from '@lobehub/ui';
import { SearchIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import SideBarDrawer from '@/features/NavPanel/SideBarDrawer';
import { useClientDataSWR } from '@/libs/swr';
import { recentService } from '@/services/recent';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { ALL_RECENTS_DRAWER_SWR_PREFIX } from '@/store/home/slices/recent/action';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import RecentListItem from './Item';

interface AllRecentsDrawerProps {
  onClose: () => void;
  open: boolean;
}

const AllRecentsDrawer = memo<AllRecentsDrawerProps>(({ open, onClose }) => {
  const { t } = useTranslation('common');
  const [searchKeyword, setSearchKeyword] = useState('');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);

  const { data: recents, isLoading } = useClientDataSWR(
    open ? [ALL_RECENTS_DRAWER_SWR_PREFIX, open] : null,
    () => recentService.getAll(50),
  );

  const filteredRecents = useMemo(() => {
    if (!recents) return [];
    const baseRecents = enableAgentTask ? recents : recents.filter((item) => item.type !== 'task');
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return baseRecents;
    return baseRecents.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [recents, searchKeyword, enableAgentTask]);

  const fallbackAgentId = activeAgentId || inboxAgentId;
  const getRecentRoute = useCallback(
    (item: (typeof filteredRecents)[number]) => {
      if (item.type !== 'task') return item.routePath;
      const targetAgentId = item.agentId || fallbackAgentId;
      const taskId = item.id;
      if (!targetAgentId || !taskId) return item.routePath;

      return `/agent/${targetAgentId}/tasks/${taskId}`;
    },
    [fallbackAgentId],
  );

  return (
    <SideBarDrawer
      open={open}
      title={t('recents')}
      subHeader={
        <Flexbox paddingBlock={'0 8px'} paddingInline={8}>
          <SearchBar
            allowClear
            defaultValue={searchKeyword}
            placeholder={t('navPanel.searchRecent')}
            onSearch={(keyword) => setSearchKeyword(keyword)}
            onInputChange={(keyword) => {
              setSearchKeyword(keyword);
            }}
          />
        </Flexbox>
      }
      onClose={onClose}
    >
      <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
        {isLoading || !recents ? (
          <SkeletonList rows={5} />
        ) : filteredRecents.length === 0 && searchKeyword.trim() ? (
          <Empty
            description={t('navPanel.searchResultEmpty')}
            icon={SearchIcon}
            style={{ paddingBlock: 24 }}
          />
        ) : (
          filteredRecents.map((item) => (
            <Link
              key={`${item.type}-${item.id}`}
              style={{ color: 'inherit', textDecoration: 'none' }}
              to={getRecentRoute(item)}
            >
              <RecentListItem {...item} />
            </Link>
          ))
        )}
      </Flexbox>
    </SideBarDrawer>
  );
});

AllRecentsDrawer.displayName = 'AllRecentsDrawer';

export default AllRecentsDrawer;
