'use client';

import { Beaker } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

import SidebarGroup from './SidebarGroup';

interface ExperimentListProps {
  activeHref?: string;
  itemKey: string;
}

const ExperimentList = ({ activeHref, itemKey }: ExperimentListProps) => {
  const { t } = useTranslation('eval');
  const experimentList = useEvalStore((s) => s.experimentList);
  const useFetchExperiments = useEvalStore((s) => s.useFetchExperiments);
  const { data, error, isLoading, mutate } = useFetchExperiments();

  return (
    <SidebarGroup
      activeHref={activeHref}
      emptyHint={t('home.sidebar.experimentsEmpty')}
      error={error}
      isLoading={isLoading && data === undefined}
      itemKey={itemKey}
      title={t('sidebar.experiments')}
      items={experimentList.map((experiment) => ({
        href: `/eval/experiments/${experiment.id}`,
        icon: Beaker,
        id: experiment.id,
        title: experiment.name,
      }))}
      onRetry={() => mutate()}
    />
  );
};

export default ExperimentList;
