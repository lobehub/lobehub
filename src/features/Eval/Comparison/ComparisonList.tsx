'use client';

import { type EvalRunConfig, type EvalRunMetrics } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import StatusBadge from '../StatusBadge';
import { styles } from './style';
import { cellVerdict, type ComparisonCell } from './utils';
import VerdictTag from './VerdictTag';

export interface ComparisonListItem {
  /** This case's cells, when the list is scoped to one test case. */
  cells?: ComparisonCell[];
  run: {
    config?: EvalRunConfig | null;
    createdAt: Date | string;
    id: string;
    metrics?: EvalRunMetrics | null;
    name?: string | null;
    status: string;
  };
}

/** Links to cross-model comparisons, newest first — on a dataset or a single case. */
const ComparisonList = memo<{ items: ComparisonListItem[] }>(({ items }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox gap={8}>
      {items.map(({ cells, run }) => {
        const targets = run.config?.replayTargets ?? [];
        const passRate = run.metrics?.passRate;

        return (
          <WorkspaceLink
            data-testid="comparison-list-item"
            key={run.id}
            style={{ color: 'inherit', textDecoration: 'none' }}
            to={`/eval/comparisons/${run.id}`}
          >
            <Flexbox className={`${styles.card} ${styles.resultRow}`} gap={8} padding={12}>
              <Flexbox horizontal align="center" gap={12} justify="space-between">
                <Text ellipsis weight={600}>
                  {run.name || t('comparison.title')}
                </Text>
                <Flexbox horizontal align="center" gap={12} style={{ flexShrink: 0 }}>
                  {typeof passRate === 'number' && (
                    <span className={styles.mono}>
                      {t('comparison.list.passRate', { rate: Math.round(passRate * 100) })}
                    </span>
                  )}
                  <StatusBadge status={run.status} />
                </Flexbox>
              </Flexbox>
              <Flexbox horizontal align="center" gap={6} wrap="wrap">
                {cells
                  ? cells.map((cell) => (
                      <Flexbox horizontal align="center" gap={4} key={cell.id}>
                        <VerdictTag verdict={cellVerdict(cell)} />
                        <Text fontSize={12} type="secondary">
                          {cell.model}
                        </Text>
                      </Flexbox>
                    ))
                  : targets.map((target) => (
                      <span
                        className={styles.mono}
                        key={`${target.provider}/${target.model}`}
                        style={{ color: cssVar.colorTextSecondary }}
                      >
                        {target.model}
                      </span>
                    ))}
                <Text fontSize={12} style={{ marginInlineStart: 'auto' }} type="secondary">
                  {new Date(run.createdAt).toLocaleString()}
                </Text>
              </Flexbox>
            </Flexbox>
          </WorkspaceLink>
        );
      })}
    </Flexbox>
  );
});

ComparisonList.displayName = 'EvalComparisonList';

export default ComparisonList;
