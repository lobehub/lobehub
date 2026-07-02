'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import SegmentBar from '@/routes/(main)/eval/features/SegmentBar';
import StatusBadge from '@/routes/(main)/eval/features/StatusBadge';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};

    transition:
      border-color 0.15s ease,
      background 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  name: css`
    overflow: hidden;

    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  passRate: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading3};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  score: css`
    font-family: ${cssVar.fontFamilyCode};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  unit: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface RunSummaryCardProps {
  benchmarkId: string;
  id: string;
  metrics?: {
    averageScore?: number;
    passRate?: number;
    totalCases?: number;
  };
  name?: string;
  status: string;
}

const RunSummaryCard = memo<RunSummaryCardProps>(({ id, name, status, metrics, benchmarkId }) => {
  const { t } = useTranslation('eval');
  const isActive = status === 'running' || status === 'pending';

  const passRate = metrics?.passRate;
  const totalCases = metrics?.totalCases ?? 0;
  // Derive a pass/fail split from the headline rate so the breakdown bar matches
  // the number shown — the summary metrics shape carries no per-status counts.
  const passedCases =
    passRate !== undefined && totalCases > 0 ? Math.round(passRate * totalCases) : 0;
  const failedCases = totalCases > 0 ? Math.max(0, totalCases - passedCases) : 0;
  const showResults = !isActive && passRate !== undefined;

  return (
    <WorkspaceLink
      style={{ color: 'inherit', textDecoration: 'none' }}
      to={`/eval/bench/${benchmarkId}/runs/${id}`}
    >
      <Flexbox className={styles.card} gap={10}>
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <span className={styles.name}>{name || id.slice(0, 8)}</span>
          <StatusBadge status={status} />
        </Flexbox>

        {showResults && (
          <Flexbox gap={8}>
            {/* Pass-rate hero — the run's headline outcome */}
            <Flexbox horizontal align="baseline" gap={6}>
              <span className={styles.passRate}>{Math.round(passRate! * 100)}%</span>
              <span className={styles.unit}>{t('run.metrics.passRate')}</span>
            </Flexbox>
            {totalCases > 0 && (
              <SegmentBar
                segments={[
                  { color: cssVar.colorSuccess, value: passedCases },
                  { color: cssVar.colorError, value: failedCases },
                ]}
              />
            )}
            {metrics?.averageScore !== undefined && (
              <Flexbox horizontal align="center" gap={6}>
                <Text fontSize={12} type="secondary">
                  {t('run.metrics.avgScore')}
                </Text>
                <span className={styles.score}>{metrics.averageScore.toFixed(2)}</span>
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Flexbox>
    </WorkspaceLink>
  );
});

export default RunSummaryCard;
