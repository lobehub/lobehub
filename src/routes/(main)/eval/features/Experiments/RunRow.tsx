'use client';

import type { AgentEvalRunListItem } from '@lobechat/types';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import SegmentBar from '../SegmentBar';
import StatusBadge from '../StatusBadge';

const styles = createStaticStyles(({ css }) => ({
  passRate: css`
    font-family: ${cssVar.fontFamilyCode};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  row: css`
    padding-block: 10px;
    padding-inline: 4px;
    border-radius: ${cssVar.borderRadius};
    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

interface RunRowProps {
  benchmarkId: string;
  run: AgentEvalRunListItem;
}

/**
 * Compact read-only run row for the experiment workspace: name + status +
 * pass/fail/error breakdown + pass rate, linking out to the full run page.
 */
const RunRow = memo<RunRowProps>(({ run, benchmarkId }) => {
  const passCount = run.passCount ?? run.metrics?.passedCases ?? 0;
  const failCount = run.failCount ?? run.metrics?.failedCases ?? 0;
  const errorCount = run.errorCount ?? run.metrics?.errorCases ?? 0;
  const passRate = run.passRate ?? run.metrics?.passRate;

  return (
    <Flexbox horizontal align="center" className={styles.row} gap={12}>
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8}>
          <Text ellipsis weight={500}>
            {run.name || run.id}
          </Text>
          <StatusBadge status={run.status} />
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          {run.datasetName && (
            <Text fontSize={12} type="secondary">
              {run.datasetName}
            </Text>
          )}
          <Text fontSize={12} type="secondary">
            {new Date(run.createdAt).toLocaleDateString()}
          </Text>
        </Flexbox>
      </Flexbox>

      <Flexbox align="flex-end" gap={4} style={{ width: 140 }}>
        {typeof passRate === 'number' && (
          <span className={styles.passRate}>{(passRate * 100).toFixed(0)}%</span>
        )}
        <SegmentBar
          height={6}
          segments={[
            { color: cssVar.colorSuccess, value: passCount },
            { color: cssVar.colorError, value: failCount },
            { color: cssVar.colorWarning, value: errorCount },
          ]}
        />
      </Flexbox>

      <WorkspaceLink to={`/eval/bench/${benchmarkId}/runs/${run.id}`}>
        <ActionIcon icon={ChevronRight} size={'small'} />
      </WorkspaceLink>
    </Flexbox>
  );
});

export default RunRow;
