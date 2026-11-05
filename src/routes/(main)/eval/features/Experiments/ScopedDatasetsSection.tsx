'use client';

import { Block, Empty, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DatasetRow from './DatasetRow';
import type { useExperimentActions } from './useExperimentActions';

const styles = stylex.create({
  listCard: { paddingBlock: '4px', paddingInline: '8px', borderRadius: cssVar.borderRadiusLG },
  sectionTitle: { margin: '0', fontSize: '16px', fontWeight: 600 },
});

interface ScopedDatasetsSectionProps {
  actions: ReturnType<typeof useExperimentActions>;
}

/** Experiment-scoped subsets / forks — read-only display with "Add Run". */
const ScopedDatasetsSection = memo<ScopedDatasetsSectionProps>(({ actions }) => {
  const { t } = useTranslation('eval');
  const { scopedDatasets } = actions;

  return (
    <Flexbox gap={12}>
      <h3 {...stylex.props(styles.sectionTitle)}>{t('experiment.detail.datasetsScoped')}</h3>
      <Block className={stylex.props(styles.listCard).className} variant={'outlined'}>
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
