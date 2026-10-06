'use client';

import { Block, Empty, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DatasetRow from './DatasetRow';
import type { useExperimentActions } from './useExperimentActions';

const styles = createStaticStyles(({ css, cssVar }) => ({
  listCard: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  sectionTitle: css`
    margin: 0;
    font-size: 16px;
    font-weight: 600;
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
    <Flexbox gap={12}>
      <h3 className={styles.sectionTitle}>{t('experiment.detail.datasetsScoped')}</h3>
      <Block className={styles.listCard} variant={'outlined'}>
        {scopedDatasets.length === 0 ? (
          <Empty description={t('experiment.detail.datasetsScopedEmpty')} icon={Database} />
        ) : (
          <Flexbox gap={0}>
            {scopedDatasets.map((dataset) => (
              <DatasetRow dataset={dataset} key={dataset.id} onAddRun={actions.addRun} />
            ))}
          </Flexbox>
        )}
      </Block>
    </Flexbox>
  );
});

export default ScopedDatasetsSection;
