'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { Block, Empty, Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, Database } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import EvalSection from '@/features/Eval/components/EvalSection';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import DatasetRow from './DatasetRow';
import type { useExperimentActions } from './useExperimentActions';

const styles = createStaticStyles(({ css, cssVar }) => ({
  cardBody: css`
    padding-block: 4px;
    padding-inline: 8px;
  `,
  cardHeader: css`
    min-height: 56px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: ${cssVar.fontSize};
    font-weight: 500;
  `,
  listCard: css`
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));

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
    <EvalSection count={groups.length} title={t('experiment.detail.benchmarks')}>
      <Flexbox gap={12}>
        {groups.map(({ benchmark, datasets }) => (
          <Block className={styles.listCard} key={benchmark.id} variant={'outlined'}>
            <Flexbox
              horizontal
              align={'center'}
              className={styles.cardHeader}
              justify={'space-between'}
            >
              <span>{benchmark.name}</span>
              <WorkspaceLink to={`/eval/bench/${benchmark.id}`}>
                <ActionIcon icon={ChevronRight} size={'small'} />
              </WorkspaceLink>
            </Flexbox>
            <div className={styles.cardBody}>
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
    </EvalSection>
  );
});

export default BenchmarksSection;
