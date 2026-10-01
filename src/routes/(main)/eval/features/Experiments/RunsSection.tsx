'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { Block, Empty, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FlaskConical } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import RunRow from './RunRow';
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
      <h3 className={styles.sectionTitle}>{t('experiment.detail.runs')}</h3>
      <Block className={styles.listCard} variant={'outlined'}>
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
