'use client';

import { Empty, Flexbox } from '@lobehub/ui';
import { Card } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DatasetRow from './DatasetRow';
import type { useExperimentActions } from './useExperimentActions';

const styles = createStaticStyles(({ css }) => ({
  listCard: css`
    .ant-card-body {
      padding-block: 4px;
      padding-inline: 8px;
    }
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
      <Card className={styles.listCard}>
        {scopedDatasets.length === 0 ? (
          <Empty description={t('experiment.detail.datasetsScopedEmpty')} icon={Database} />
        ) : (
          <Flexbox gap={0}>
            {scopedDatasets.map((dataset) => (
              <DatasetRow dataset={dataset} key={dataset.id} onAddRun={actions.addRun} />
            ))}
          </Flexbox>
        )}
      </Card>
    </Flexbox>
  );
});

export default ScopedDatasetsSection;
