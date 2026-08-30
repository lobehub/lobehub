'use client';

import { Empty, Flexbox, SearchBar } from '@lobehub/ui';
import { SearchIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import SideBarDrawer from '@/features/NavPanel/SideBarDrawer';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';

import ConnectedItem from './ConnectedItem';

interface AllRecentsDrawerProps {
  onClose: () => void;
  open: boolean;
}

const AllRecentsDrawer = memo<AllRecentsDrawerProps>(({ open, onClose }) => {
  const { t } = useTranslation('common');
  const [searchKeyword, setSearchKeyword] = useState('');
  const scope = useCacheScope();
  const useFetchAllRecents = useHomeStore((s) => s.useFetchAllRecents);
  const refs = useHomeStore(homeRecentSelectors.refs(scope));
  const entities = useHomeStore((s) => s.recentEntitiesByScope[scope]);
  const isInit = useHomeStore(homeRecentSelectors.isRecentsInit(scope));

  const { isLoading } = useFetchAllRecents(open, scope);

  const filteredRefs = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return refs;
    return refs.filter((ref) => entities?.[ref]?.title.toLowerCase().includes(keyword));
  }, [entities, refs, searchKeyword]);

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
        {isLoading && !isInit ? (
          <SkeletonList rows={5} />
        ) : filteredRefs.length === 0 && searchKeyword.trim() ? (
          <Empty
            description={t('navPanel.searchResultEmpty')}
            icon={SearchIcon}
            style={{ paddingBlock: 24 }}
          />
        ) : (
          filteredRefs.map((ref) => <ConnectedItem entityRef={ref} key={ref} scope={scope} />)
        )}
      </Flexbox>
    </SideBarDrawer>
  );
});

AllRecentsDrawer.displayName = 'AllRecentsDrawer';

export default AllRecentsDrawer;
