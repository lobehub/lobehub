'use client';

import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

import SidebarGroup from './SidebarGroup';

interface DatasetListProps {
  activeHref?: string;
  itemKey: string;
}

/**
 * Every dataset, not only the ones under a benchmark. A dataset need not belong
 * to one, and every other listing in the product is benchmark-scoped — without
 * this a captured dataset could be created but never found.
 */
const DatasetList = ({ activeHref, itemKey }: DatasetListProps) => {
  const { t } = useTranslation('eval');
  const useFetchAllDatasets = useEvalStore((s) => s.useFetchAllDatasets);
  const { data, error, isLoading, mutate } = useFetchAllDatasets();
  const datasets: Array<{ id: string; name: string }> = data ?? [];

  return (
    <SidebarGroup
      activeHref={activeHref}
      emptyHint={t('home.sidebar.datasetsEmpty')}
      error={error}
      isLoading={isLoading && data === undefined}
      itemKey={itemKey}
      title={t('sidebar.datasets')}
      items={datasets.map((d) => ({
        href: `/eval/datasets/${d.id}`,
        icon: Database,
        id: d.id,
        title: d.name,
      }))}
      onRetry={() => mutate()}
    />
  );
};

export default DatasetList;
