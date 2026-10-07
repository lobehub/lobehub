'use client';

import {
  type EvalReplayTargetMetrics,
  type EvalRunConfig,
  type EvalRunMetrics,
} from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { GitCompareArrows } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';
import ModelLabel from '@/features/Eval/components/ModelLabel';
import StatusBadge from '@/features/Eval/StatusBadge';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { styles } from './style';

export interface ComparisonRun {
  config?: EvalRunConfig | null;
  createdAt: Date | string;
  id: string;
  metrics?: EvalRunMetrics | null;
  name?: string | null;
  status: string;
}

const rateTone = (rate: number) =>
  rate >= 0.8 ? cssVar.colorSuccess : rate >= 0.5 ? cssVar.colorWarning : cssVar.colorError;

const TargetRate = ({ target }: { target: EvalReplayTargetMetrics }) => {
  const { t } = useTranslation('eval');
  const judged = target.totalCases > 0;
  const percent = Math.round(target.passRate * 100);

  return (
    <Flexbox horizontal align="center" gap={12} justify="space-between">
      <ModelLabel model={target.model} provider={target.provider} showProvider={false} size={16} />
      <Flexbox horizontal align="center" gap={8} style={{ flex: 'none' }}>
        {judged && (
          <div className={styles.rateTrack}>
            <div
              style={{
                background: rateTone(target.passRate),
                height: '100%',
                width: `${percent}%`,
              }}
            />
          </div>
        )}
        <span className={styles.rate}>
          {judged
            ? t('dataset.comparisons.rate', {
                passed: target.passedCases,
                rate: percent,
                total: target.totalCases,
              })
            : '—'}
        </span>
      </Flexbox>
    </Flexbox>
  );
};

const ComparisonRow = ({ run }: { run: ComparisonRun }) => {
  const { t } = useTranslation('eval');
  const byTarget = run.metrics?.byTarget;
  const targets = run.config?.replayTargets ?? [];

  return (
    <WorkspaceLink
      className={styles.caseRow}
      data-testid="dataset-comparison-row"
      style={{ display: 'block' }}
      to={`/eval/comparisons/${run.id}`}
    >
      <Flexbox gap={10}>
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Flexbox horizontal align="baseline" gap={8} style={{ minWidth: 0 }}>
            <span className={styles.caseInput} style={{ fontWeight: 500, WebkitLineClamp: 1 }}>
              {run.name || t('comparison.title')}
            </span>
            <span className={styles.meta} style={{ flex: 'none' }}>
              {dayjs(run.createdAt).format('YYYY-MM-DD HH:mm')}
            </span>
          </Flexbox>
          <StatusBadge status={run.status} />
        </Flexbox>
        {byTarget && byTarget.length > 0 ? (
          <Flexbox gap={6} style={{ maxWidth: 520 }}>
            {[...byTarget]
              .sort((a, b) => b.passRate - a.passRate)
              .map((target) => (
                <TargetRate key={`${target.provider}/${target.model}`} target={target} />
              ))}
          </Flexbox>
        ) : (
          <Flexbox horizontal gap={16} wrap="wrap">
            {targets.map((target) => (
              <ModelLabel
                key={`${target.provider}/${target.model}`}
                model={target.model}
                showProvider={false}
                size={16}
              />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </WorkspaceLink>
  );
};

interface ComparisonsSectionProps {
  /** Opens the compare modal; absent when the dataset has nothing replayable. */
  onCompare?: () => void;
  runs: ComparisonRun[];
}

/** Cross-model comparisons run on this dataset, newest first, with per-model pass rates. */
const ComparisonsSection = ({ onCompare, runs }: ComparisonsSectionProps) => {
  const { t } = useTranslation('eval');

  return (
    <EvalSection
      count={runs.length}
      description={t('dataset.comparisons.description')}
      title={t('comparison.list.caseTitle')}
    >
      {runs.length > 0 ? (
        <div className={styles.list}>
          {runs.map((run) => (
            <ComparisonRow key={run.id} run={run} />
          ))}
        </div>
      ) : (
        <EvalEmpty
          compact
          icon={GitCompareArrows}
          title={t('dataset.comparisons.empty')}
          action={
            onCompare && (
              <Button size="small" onClick={onCompare}>
                {t('dataset.actions.compare')}
              </Button>
            )
          }
          description={
            onCompare ? t('dataset.comparisons.emptyHint') : t('dataset.comparisons.needFrozen')
          }
        />
      )}
    </EvalSection>
  );
};

export default ComparisonsSection;
