import { Button } from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useState } from 'react';

import { useMockTopicCleanup } from '../hooks/useMockTopicCleanup';
import { useAgentMockStore } from '../store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  label: css`
    font-size: 13px;
    color: ${cssVar.colorText};
  `,
  hint: css`
    margin-block-start: 2px;
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const TOGGLES: Array<{
  hint: string;
  key: keyof ReturnType<typeof useAgentMockStore.getState>['sideEffects'];
  label: string;
}> = [
  {
    hint: 'Off → mock runs do not pollute .agent-tracing',
    key: 'recordTracing',
    label: 'Record to agent-tracing',
  },
  {
    hint: 'Off → no client.* signals to server',
    key: 'emitAgentSignal',
    label: 'Emit agent-signal events',
  },
  { hint: 'Off → no telemetry events', key: 'emitAnalytics', label: 'Emit analytics' },
  {
    hint: 'On → in-memory only is v2; v1 keeps DB writes',
    key: 'writeToDb',
    label: 'Write to mock topic (DB)',
  },
];

export const SettingsPanel = memo(() => {
  const sideEffects = useAgentMockStore((s) => s.sideEffects);
  const setSideEffects = useAgentMockStore((s) => s.setSideEffects);
  const cleanup = useMockTopicCleanup();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onClear = async () => {
    if (!confirm('Delete ALL [MOCK] topics from your account?')) return;
    setBusy(true);
    try {
      const r = await cleanup();
      setResult(`Deleted ${r.deleted} mock topics`);
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {TOGGLES.map((t) => (
        <div className={styles.row} key={t.key}>
          <div>
            <div className={styles.label}>{t.label}</div>
            <div className={styles.hint}>{t.hint}</div>
          </div>
          <Switch
            checked={sideEffects[t.key]}
            onChange={(v: boolean) => setSideEffects({ [t.key]: v })}
          />
        </div>
      ))}

      <div style={{ marginBlockStart: 24 }}>
        <Button danger loading={busy} onClick={onClear}>
          Clear all [MOCK] topics
        </Button>
        {result && (
          <div
            style={{ marginBlockStart: 8, fontSize: 11, color: 'var(--lobe-color-text-secondary)' }}
          >
            {result}
          </div>
        )}
      </div>
    </div>
  );
});

SettingsPanel.displayName = 'AgentMockSettingsPanel';
