'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { Block, Empty, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FlaskConical } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import RunRow from './RunRow';
import type { useExperimentActions } from './useExperimentActions';

const styles = stylex.create({
  listCard: { paddingBlock: '4px', paddingInline: '8px', borderRadius: cssVar.borderRadiusLG },
  sectionTitle: { margin: '0', fontSize: '16px', fontWeight: 600 },
});

interface RunsSectionProps {
  actions: ReturnType<typeof useExperimentActions>;
  experiment: AgentEvalExperimentDetail;
}

/** Experiment runs — compact read-only rows linking out to the full run page. */
const RunsSection = memo<RunsSectionProps>(({ actions, experiment }) => {
  const { t } = useTranslation('eval');
  const runs = experiment.runs || [];

  return (
    <Flexbox gap={12}>
      <h3 {...stylex.props(styles.sectionTitle)}>{t('experiment.detail.runs')}</h3>
      <Block className={stylex.props(styles.listCard).className} variant={'outlined'}>
        {runs.length === 0 ? (
          <Empty description={t('run.empty.title')} icon={FlaskConical} />
        ) : (
          <Flexbox gap={0}>
            {runs.map((run) => (
              <RunRow benchmarkId={actions.resolveRunBenchmarkId(run)} key={run.id} run={run} />
            ))}
          </Flexbox>
        )}
      </Block>
    </Flexbox>
  );
});

export default RunsSection;
