'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import { useActiveBenchmarkId } from '../useActiveBenchmarkId';
import BenchmarkHead from './BenchmarkHead';

const Header = memo(() => {
  const benchmarkId = useActiveBenchmarkId();
  const { t } = useTranslation('common');
  return (
    <SideBarHeaderLayout
      backTo="/eval"
      left={<BenchmarkHead id={benchmarkId} />}
      breadcrumb={[
        {
          href: `/eval/bench/${benchmarkId}`,
          title: t('tab.eval'),
        },
      ]}
    />
  );
});

export default Header;
