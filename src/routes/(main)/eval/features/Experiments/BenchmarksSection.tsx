'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { ActionIcon, Block, Empty, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Database } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import DatasetRow from './DatasetRow';
import type { useExperimentActions } from './useExperimentActions';

const styles = stylex.create({
  cardBody: { paddingBlock: '4px', paddingInline: '8px' },
  cardHeader: {
    minHeight: '56px',
    paddingInline: '24px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '16px',
    fontWeight: 600,
  },
  listCard: { borderRadius: cssVar.borderRadiusLG },
  sectionTitle: { margin: '0', fontSize: '16px', fontWeight: 600 },
});

interface BenchmarksSectionProps {
  actions: ReturnType<typeof useExperimentActions>;
  experiment: AgentEvalExperimentDetail;
}

/** Baseline datasets, grouped per linked benchmark. Each row offers "Add Run". */
const BenchmarksSection = memo<BenchmarksSectionProps>(({ actions, experiment }) => {
  const { t } = useTranslation('eval');

  const groups = useMemo(
    () =>
      experiment.benchmarks.map((benchmark) => ({
        benchmark,
        datasets: actions.baselineDatasets.filter(
          (dataset) => dataset.benchmarkId === benchmark.id,
        ),
      })),
    [experiment.benchmarks, actions.baselineDatasets],
  );

  return (
    <Flexbox gap={12}>
      <h3 {...stylex.props(styles.sectionTitle)}>{t('experiment.detail.benchmarks')}</h3>
      {groups.map(({ benchmark, datasets }) => (
        <Block
          className={stylex.props(styles.listCard).className}
          key={benchmark.id}
          variant={'outlined'}
        >
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.cardHeader).className}
            justify={'space-between'}
          >
            <span>{benchmark.name}</span>
            <WorkspaceLink to={`/eval/bench/${benchmark.id}`}>
              <ActionIcon icon={ChevronRight} size={'small'} />
            </WorkspaceLink>
          </Flexbox>
          <div {...stylex.props(styles.cardBody)}>
            {datasets.length === 0 ? (
              <Empty description={t('experiment.detail.benchmarksEmpty')} icon={Database} />
            ) : (
              <Flexbox gap={0}>
                {datasets.map((dataset) => (
                  <DatasetRow dataset={dataset} key={dataset.id} onAddRun={actions.addRun} />
                ))}
              </Flexbox>
            )}
          </div>
        </Block>
      ))}
    </Flexbox>
  );
});

export default BenchmarksSection;
