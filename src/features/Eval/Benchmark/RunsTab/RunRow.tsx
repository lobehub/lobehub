import type { AgentEvalRunListItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ModelLabel from '@/features/Eval/components/ModelLabel';
import SegmentBar from '@/features/Eval/SegmentBar';
import StatusBadge from '@/features/Eval/StatusBadge';
import { formatDuration } from '@/features/Eval/utils';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { getRunPassRate } from './groupRuns';
import { getRunModel } from './runModel';
import { useRunMenu } from './useRunMenu';

export const runRowStyles = createStaticStyles(({ css }) => ({
  // model | status | pass rate | score | cases | time · cost | menu
  grid: css`
    display: grid;
    grid-template-columns:
      minmax(180px, 1.6fr) 104px minmax(140px, 1.2fr) 72px 72px minmax(96px, 0.8fr)
      28px;
    gap: 16px;
    align-items: center;

    @media (width <= 900px) {
      grid-template-columns: minmax(160px, 1.6fr) 96px minmax(120px, 1fr) 28px;

      & > [data-optional] {
        display: none;
      }
    }
  `,
  head: css`
    padding-block: 8px;
    padding-inline: 16px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
  num: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
  `,
  numMuted: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  passValue: css`
    min-width: 40px;

    font-family: ${cssVar.fontFamilyCode};
    font-weight: ${cssVar.fontWeightStrong};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
    text-align: end;
  `,
  right: css`
    text-align: end;
  `,
  row: css`
    padding-block: 10px;
    padding-inline: 16px;
    color: inherit;
    transition: background 0.15s ease;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

const styles = runRowStyles;

/** Column labels for a group of run rows. */
export const RunRowHead = () => {
  const { t } = useTranslation('eval');
  return (
    <div className={`${styles.grid} ${styles.head}`}>
      <span>{t('benchmark.runs.column.model')}</span>
      <span>{t('benchmark.runs.column.status')}</span>
      <span>{t('run.metrics.passRate')}</span>
      <span data-optional className={styles.right}>
        {t('run.metrics.avgScore')}
      </span>
      <span data-optional className={styles.right}>
        {t('benchmark.detail.stats.cases')}
      </span>
      <span data-optional className={styles.right}>
        {t('benchmark.runs.column.cost')}
      </span>
      <span />
    </div>
  );
};

interface RunRowProps {
  benchmarkId: string;
  isBest?: boolean;
  onEdit?: (run: AgentEvalRunListItem) => void;
  onRefresh?: () => Promise<void>;
  run: AgentEvalRunListItem;
}

const RunRow = ({ benchmarkId, isBest, onEdit, onRefresh, run }: RunRowProps) => {
  const { t } = useTranslation('eval');
  const menuItems = useRunMenu(run, { onEdit, onRefresh });

  const model = getRunModel(run);
  const metrics = run.metrics;
  const total = metrics?.totalCases ?? run.totalCases ?? 0;
  const passed = metrics?.passedCases ?? 0;
  const failed = metrics?.failedCases ?? 0;
  const errored = metrics?.errorCases ?? 0;
  const done = passed + failed + errored;
  const passRate = getRunPassRate(run);
  const avgScore = metrics?.averageScore ?? run.averageScore;
  const duration = metrics?.duration ?? run.totalDuration;
  const cost = metrics?.totalCost ?? run.totalCost;

  return (
    <WorkspaceLink
      className={`${styles.grid} ${styles.row}`}
      to={`/eval/bench/${benchmarkId}/runs/${run.id}`}
    >
      <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
        {model ? (
          <ModelLabel model={model.model} provider={model.provider} />
        ) : (
          <span className={styles.numMuted}>{t('benchmark.runs.agentModel')}</span>
        )}
        {isBest && (
          <Tag color="success" size="small">
            {t('benchmark.runs.best')}
          </Tag>
        )}
      </Flexbox>
      <StatusBadge status={run.status} />
      <Flexbox
        horizontal
        align="center"
        gap={10}
        title={`✓ ${passed} · ✗ ${failed} · ⚠ ${errored} / ${total}`}
      >
        <Flexbox flex={1}>
          <SegmentBar
            height={6}
            segments={[
              { color: cssVar.colorSuccess, value: passed },
              { color: cssVar.colorError, value: failed },
              { color: cssVar.colorWarning, value: errored },
              { color: 'transparent', value: Math.max(total - done, 0) },
            ]}
          />
        </Flexbox>
        <span className={styles.passValue}>
          {passRate !== undefined ? `${Math.round(passRate * 100)}%` : '—'}
        </span>
      </Flexbox>
      <span data-optional className={`${styles.num} ${styles.right}`}>
        {avgScore != null && passRate !== undefined ? avgScore.toFixed(2) : '—'}
      </span>
      <span data-optional className={`${styles.numMuted} ${styles.right}`}>
        {total > 0 ? `${passed}/${total}` : '—'}
      </span>
      <span data-optional className={`${styles.numMuted} ${styles.right}`}>
        {[duration ? formatDuration(duration) : null, cost ? `$${cost.toFixed(2)}` : null]
          .filter(Boolean)
          .join(' · ') || '—'}
      </span>
      <span
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <DropdownMenu items={menuItems} placement="bottomRight">
          <ActionIcon icon={Ellipsis} size="small" title={t('benchmark.runs.more')} />
        </DropdownMenu>
      </span>
    </WorkspaceLink>
  );
};

export default RunRow;
