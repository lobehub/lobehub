'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FlaskConical } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';

import RunRow from './RunRow';
import type { useExperimentActions } from './useExperimentActions';

const styles = createStaticStyles(({ css, cssVar }) => ({
  listCard: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));

interface RunsSectionProps {
  actions: ReturnType<typeof useExperimentActions>;
  experiment: AgentEvalExperimentDetail;
}

/** Experiment runs — compact read-only rows linking out to the full run page. */
const RunsSection = memo<RunsSectionProps>(({ actions, experiment }) => {
  const { t } = useTranslation('eval');
  const runs = experiment.runs || [];

  return (
    <EvalSection count={runs.length} title={t('experiment.detail.runs')}>
      {runs.length === 0 ? (
        <EvalEmpty compact icon={FlaskConical} title={t('run.empty.title')} />
      ) : (
        <Block className={styles.listCard} variant={'outlined'}>
          <Flexbox gap={0}>
            {runs.map((run) => (
              <RunRow benchmarkId={actions.resolveRunBenchmarkId(run)} key={run.id} run={run} />
            ))}
          </Flexbox>
        </Block>
      )}
    </EvalSection>
  );
});

export default RunsSection;
