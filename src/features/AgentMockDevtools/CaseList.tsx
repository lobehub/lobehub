import { Input } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useState } from 'react';

import { useMockCases } from './hooks/useMockCases';
import { useAgentMockStore } from './store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  sidebar: css`
    display: flex;
    flex-direction: column;

    width: 260px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillAlter};
  `,
  search: css`
    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  list: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 8px;
  `,
  group: css`
    padding-block: 8px 4px;
    padding-inline: 14px;

    font-size: 10px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 1px;
  `,
  item: css`
    cursor: pointer;

    padding-block: 7px;
    padding-inline: 14px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  active: css`
    border-inline-start: 3px solid ${cssVar.colorPrimary};
    font-weight: 500;
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};
  `,
}));

export const CaseList = memo(() => {
  const { builtins, snapshots, generated } = useMockCases();
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const setSelectedCaseId = useAgentMockStore((s) => s.setSelectedCaseId);
  const [q, setQ] = useState('');

  const filter = <T extends { id: string; name: string }>(arr: T[]) =>
    arr.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));

  const renderItem = (c: { id: string; name: string }) => (
    <div
      className={`${styles.item} ${selectedCaseId === c.id ? styles.active : ''}`}
      key={c.id}
      onClick={() => setSelectedCaseId(c.id)}
    >
      {c.name}
    </div>
  );

  return (
    <aside className={styles.sidebar}>
      <div className={styles.search}>
        <Input
          placeholder="Search cases…"
          size="small"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className={styles.list}>
        <div className={styles.group}>▾ Builtin ({builtins.length})</div>
        {filter(builtins).map(renderItem)}
        <div className={styles.group}>▾ Snapshots ({snapshots.length})</div>
        {filter(snapshots).map(renderItem)}
        <div className={styles.group}>▾ Generated ({generated.length})</div>
        {filter(generated).map(renderItem)}
      </div>
    </aside>
  );
});

CaseList.displayName = 'AgentMockCaseList';
