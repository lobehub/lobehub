import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { useAgentMockStore } from '../store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  wrap: css`
    display: flex;
    gap: 12px;
    align-items: center;

    margin-block-end: 16px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
  `,
  bar: css`
    overflow: hidden;
    flex: 1;

    height: 6px;
    border-radius: 3px;

    background: ${cssVar.colorBorderSecondary};
  `,
  fill: css`
    height: 100%;
    background: linear-gradient(90deg, #6366f1, #8b5cf6);
  `,
}));

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export const ProgressBar = memo(() => {
  const playback = useAgentMockStore((s) => s.playback);
  if (!playback) return null;
  const pct = playback.totalEvents
    ? Math.min(100, (playback.currentEventIndex / playback.totalEvents) * 100)
    : 0;

  return (
    <div className={styles.wrap}>
      <span style={{ minWidth: 50 }}>{fmt(playback.elapsedMs)}</span>
      <div className={styles.bar}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <span style={{ minWidth: 50, textAlign: 'end' }}>{fmt(playback.totalDurationMs)}</span>
    </div>
  );
});

ProgressBar.displayName = 'AgentMockProgressBar';
