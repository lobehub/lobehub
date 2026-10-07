import type { AgentEvalRunListItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { getRunPassRate, type RunGroup as RunGroupData } from './groupRuns';
import RunRow, { RunRowHead } from './RunRow';

const styles = createStaticStyles(({ css }) => ({
  agent: css`
    overflow: hidden;

    font-weight: ${cssVar.fontWeightStrong};
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  block: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  dataset: css`
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
  header: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  meta: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  num: css`
    font-variant-numeric: tabular-nums;
  `,
}));

interface RunGroupProps {
  benchmarkId: string;
  group: RunGroupData;
  onEdit?: (run: AgentEvalRunListItem) => void;
  onRefresh?: () => Promise<void>;
}

const formatDate = (time: number, locale?: string) =>
  new Date(time).toLocaleString(locale, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });

/**
 * One agent on one dataset, created together: each row is one model, best
 * pass rate first, so a multi-model run reads as a side-by-side comparison.
 */
const RunGroup = ({ benchmarkId, group, onEdit, onRefresh }: RunGroupProps) => {
  const { i18n, t } = useTranslation('eval');
  const agent = group.runs[0]?.targetAgent;

  // "Best" only means something when at least two models finished and one leads.
  const rates = group.runs.map(getRunPassRate).filter((r): r is number => r !== undefined);
  const bestId = rates.length > 1 && rates[0] > rates[1] ? group.runs[0]?.id : undefined;

  return (
    <div className={styles.block}>
      <Flexbox horizontal align="center" className={styles.header} gap={12} justify="space-between">
        <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
          <Avatar avatar={agent?.avatar || undefined} size={24} title={group.agentTitle} />
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <span className={styles.agent}>{group.agentTitle || t('common.unknown')}</span>
            <Flexbox horizontal align="center" className={styles.meta} gap={6} wrap="wrap">
              {group.datasetName && (
                <>
                  <WorkspaceLink
                    className={styles.dataset}
                    to={`/eval/datasets/${group.datasetId}`}
                  >
                    {group.datasetName}
                  </WorkspaceLink>
                  <span>·</span>
                </>
              )}
              <span className={styles.num}>{formatDate(group.createdAt, i18n.language)}</span>
            </Flexbox>
          </Flexbox>
        </Flexbox>
        {group.runs.length > 1 && (
          <span className={`${styles.meta} ${styles.num}`}>
            {t('benchmark.runs.modelCount', { count: group.runs.length })}
          </span>
        )}
      </Flexbox>
      <RunRowHead />
      {group.runs.map((run) => (
        <RunRow
          benchmarkId={benchmarkId}
          isBest={run.id === bestId}
          key={run.id}
          run={run}
          onEdit={onEdit}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
};

export default RunGroup;
