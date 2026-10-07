'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';

import DatasetRow from './DatasetRow';
import type { useExperimentActions } from './useExperimentActions';

const styles = createStaticStyles(({ css, cssVar }) => ({
  listCard: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));

interface ScopedDatasetsSectionProps {
  actions: ReturnType<typeof useExperimentActions>;
}

/** Experiment-scoped subsets / forks — read-only display with "Add Run". */
const ScopedDatasetsSection = memo<ScopedDatasetsSectionProps>(({ actions }) => {
  const { t } = useTranslation('eval');
  const { scopedDatasets } = actions;

  return (
    <EvalSection count={scopedDatasets.length} title={t('experiment.detail.datasetsScoped')}>
      {scopedDatasets.length === 0 ? (
        <EvalEmpty compact icon={Database} title={t('experiment.detail.datasetsScopedEmpty')} />
      ) : (
        <Block className={styles.listCard} variant={'outlined'}>
          <Flexbox gap={0}>
            {scopedDatasets.map((dataset) => (
              <DatasetRow dataset={dataset} key={dataset.id} onAddRun={actions.addRun} />
            ))}
          </Flexbox>
        </Block>
      )}
    </EvalSection>
  );
});

export default ScopedDatasetsSection;
