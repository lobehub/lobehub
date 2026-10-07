'use client';

import { User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getBenchmarkIcon } from '@/features/Eval/Benchmark/benchmarkIcon';
import { useEvalStore } from '@/store/eval';

import SidebarGroup from './SidebarGroup';

interface BenchmarkListProps {
  activeHref?: string;
  itemKey: string;
}

const BenchmarkList = ({ activeHref, itemKey }: BenchmarkListProps) => {
  const { t } = useTranslation('eval');
  const benchmarkList = useEvalStore((s) => s.benchmarkList);
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  const { data, error, isLoading, mutate } = useFetchBenchmarks();

  return (
    <SidebarGroup
      activeHref={activeHref}
      emptyHint={t('home.sidebar.benchmarksEmpty')}
      error={error}
      isLoading={isLoading && data === undefined}
      itemKey={itemKey}
      title={t('sidebar.benchmarks')}
      items={benchmarkList.map((b: any) => ({
        href: `/eval/bench/${b.id}`,
        icon: b.source === 'user' ? User : getBenchmarkIcon(b.id),
        id: b.id,
        title: b.name,
      }))}
      onRetry={() => mutate()}
    />
  );
};

export default BenchmarkList;
