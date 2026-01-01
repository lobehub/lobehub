'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import dynamic from 'next/dynamic';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarDrawer from '@/features/NavPanel/SideBarDrawer';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';

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
      onClose={onClose}
      open={open}
      subHeader={
        <Flexbox paddingBlock={'0 8px'} paddingInline={8}>
          <SearchBar
            allowClear
            defaultValue={searchKeyword}
            onInputChange={(keyword) => {
              if (!keyword) setSearchKeyword('');
            }}
            onSearch={(keyword) => setSearchKeyword(keyword)}
            placeholder={t('navPanel.searchAgent')}
          />
        </Flexbox>
      }
      title={t('navPanel.agent')}
    >
      <Content open={open} searchKeyword={searchKeyword} />
    </SideBarDrawer>
  );
});

AllAgentsDrawer.displayName = 'AllAgentsDrawer';

export default AllAgentsDrawer;
