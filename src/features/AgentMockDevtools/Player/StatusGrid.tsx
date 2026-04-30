import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { useAgentMockStore } from '../store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-block-end: 16px;
  `,
  card: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
  `,
  label: css`
    margin-block-end: 4px;

    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 1px;
  `,
  value: css`
    font-size: 18px;
    font-feature-settings: 'tnum';
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  sub: css`
    margin-block-start: 2px;
    font-size: 10px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export const StatusGrid = memo(() => {
  const playback = useAgentMockStore((s) => s.playback);
  if (!playback) return null;
  const totalSec = (playback.totalDurationMs / 1000).toFixed(1);
  const elapsedSec = (playback.elapsedMs / 1000).toFixed(1);

  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        <div className={styles.label}>Step</div>
        <div className={styles.value}>
          {playback.currentStepIndex + 1} / {playback.totalSteps}
        </div>
        <div className={styles.sub}>{playback.status}</div>
      </div>
      <div className={styles.card}>
        <div className={styles.label}>Event</div>
        <div className={styles.value}>
          {playback.currentEventIndex} / {playback.totalEvents}
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.label}>Tools</div>
        <div className={styles.value}>
          {playback.toolsExecuted} / {playback.totalTools}
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.label}>Elapsed</div>
        <div className={styles.value}>{elapsedSec}s</div>
        <div className={styles.sub}>
          @ {playback.speedMultiplier === 'instant' ? '∞' : `${playback.speedMultiplier}×`} · total{' '}
          {totalSec}s
        </div>
      </div>
    </div>
  );
});

StatusGrid.displayName = 'AgentMockStatusGrid';
