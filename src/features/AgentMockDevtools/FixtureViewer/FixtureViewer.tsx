import { Button } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Copy } from 'lucide-react';
import { memo, useMemo } from 'react';

import { useMockCases } from '../hooks/useMockCases';
import { useAgentMockStore } from '../store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  wrap: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
  `,
  pre: css`
    overflow: auto;
    flex: 1;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;

    font-family: ui-monospace, monospace;
    font-size: 11px;
    line-height: 1.5;

    background: ${cssVar.colorFillAlter};
  `,
}));

export const FixtureViewer = memo(() => {
  const { all } = useMockCases();
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const c = all.find((x) => x.id === selectedCaseId);

  const json = useMemo(() => (c ? JSON.stringify(c, null, 2) : ''), [c]);

  if (!c) return <div style={{ color: 'var(--lobe-color-text-secondary)' }}>Select a case.</div>;

  return (
    <div className={styles.wrap}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          icon={<Copy size={14} />}
          size="small"
          onClick={() =>
            navigator.clipboard
              .writeText(json)
              .catch((err) => console.error('[AgentMock] Copy failed:', err))
          }
        >
          Copy
        </Button>
      </div>
      <pre className={styles.pre}>{json}</pre>
    </div>
  );
});

FixtureViewer.displayName = 'AgentMockFixtureViewer';
