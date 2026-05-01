import { Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { useMockCases } from '../hooks/useMockCases';
import { useAgentMockStore } from '../store/agentMockStore';
import { Controls } from './Controls';
import { ProgressBar } from './ProgressBar';
import { StatusGrid } from './StatusGrid';

const styles = createStaticStyles(({ css }) => ({
  head: css`
    margin-block-end: 20px;
  `,
  name: css`
    margin-block-end: 6px;
    font-size: 18px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  meta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  empty: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

export const PlayerPanel = memo(() => {
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const { all } = useMockCases();
  const c = all.find((x) => x.id === selectedCaseId);

  if (!c) {
    return <div className={styles.empty}>Select a case from the sidebar.</div>;
  }

  return (
    <div>
      <div className={styles.head}>
        <div className={styles.name}>{c.name}</div>
        <div className={styles.meta}>
          {c.tags?.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
          {c.meta?.toolCount != null && <Tag>{c.meta.toolCount} tools</Tag>}
          {c.meta?.estimatedDurationMs != null && (
            <Tag>~{(c.meta.estimatedDurationMs / 1000).toFixed(1)}s @ 1×</Tag>
          )}
        </div>
      </div>

      <StatusGrid />
      <Controls />
      <ProgressBar />
    </div>
  );
});

PlayerPanel.displayName = 'AgentMockPlayerPanel';
