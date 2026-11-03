'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import SideBarDrawer from '@/features/NavPanel/SideBarDrawer';
import dynamic from '@/libs/next/dynamic';

const Content = dynamic(() => import('./Content'), {
  loading: () => (
    <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
      <SkeletonList rows={3} />
    </Flexbox>
  ),
  ssr: false,
});

interface AllAgentsDrawerProps {
  onClose: () => void;
  open: boolean;
}

const AllAgentsDrawer = memo<AllAgentsDrawerProps>(({ open, onClose }) => {
  const { t } = useTranslation('common');
  const [searchKeyword, setSearchKeyword] = useState('');

  return (
    <SideBarDrawer
      open={open}
      title={t('navPanel.agent')}
      subHeader={
        <Flexbox paddingBlock={'0 8px'} paddingInline={8}>
          <SearchBar
            allowClear
            defaultValue={searchKeyword}
            placeholder={t('navPanel.searchAgent')}
            onSearch={(keyword) => setSearchKeyword(keyword)}
            onInputChange={(keyword) => {
              if (!keyword) setSearchKeyword('');
            }}
          />
        </Flexbox>
      }
      onClose={onClose}
    >
      <Content open={open} searchKeyword={searchKeyword} />
    </SideBarDrawer>
  );
});

AllAgentsDrawer.displayName = 'AllAgentsDrawer';

export default AllAgentsDrawer;
