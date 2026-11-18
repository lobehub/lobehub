'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { benchmarkSidebarBackPath } from '@/features/LobeBench/experimentNavigation';
import { useIsLobeBenchBenchmark } from '@/features/LobeBench/useIsLobeBenchBenchmark';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import { useActiveBenchmarkId } from '../useActiveBenchmarkId';
import BenchmarkHead from './BenchmarkHead';

const Header = memo(() => {
  const benchmarkId = useActiveBenchmarkId();
  const { t } = useTranslation('common');
  const lobeBench = useIsLobeBenchBenchmark(benchmarkId);
  return (
    <SideBarHeaderLayout
      backTo={benchmarkSidebarBackPath(benchmarkId, lobeBench)}
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
