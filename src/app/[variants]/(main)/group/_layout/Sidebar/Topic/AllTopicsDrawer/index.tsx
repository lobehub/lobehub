'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import dynamic from '@/libs/next/dynamic';
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

interface AllTopicsDrawerProps {
  onClose: () => void;
  open: boolean;
}

const AllTopicsDrawer = memo<AllTopicsDrawerProps>(({ open, onClose }) => {
  const { t } = useTranslation('topic');
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
            placeholder={t('searchPlaceholder')}
          />
        </Flexbox>
      }
      title={t('title')}
    >
      <Content open={open} searchKeyword={searchKeyword} />
    </SideBarDrawer>
  );
});

AllTopicsDrawer.displayName = 'AllTopicsDrawer';

export default AllTopicsDrawer;
