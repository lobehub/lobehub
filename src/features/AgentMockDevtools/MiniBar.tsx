import { ActionIcon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Maximize2, Pause, Play, SkipForward, X } from 'lucide-react';
import { memo } from 'react';

import { useAgentMockPlayer } from './hooks/useAgentMockPlayer';
import { useAgentMockStore } from './store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    position: fixed;
    z-index: 1100;
    inset-block-end: 16px;
    inset-inline-end: 64px;

    width: 360px;
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: 10px;

    font-size: 12px;
    color: #fff;

    background: rgb(28 32 38 / 92%);
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
  `,
  row: css`
    display: flex;
    gap: 10px;
    align-items: center;
    margin-block-end: 6px;
  `,
  title: css`
    flex: 1;
    font-weight: 600;
  `,
  progress: css`
    overflow: hidden;

    height: 4px;
    margin-block-end: 8px;
    border-radius: 2px;

    background: rgb(255 255 255 / 15%);
  `,
  fill: css`
    height: 100%;
    background: linear-gradient(90deg, #6366f1, #8b5cf6);
  `,
}));

export const MiniBar = memo(() => {
  const playback = useAgentMockStore((s) => s.playback);
  const setModalState = useAgentMockStore((s) => s.setModalState);
  const modalState = useAgentMockStore((s) => s.modalState);
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const { pause, resume, stepStep, stop } = useAgentMockPlayer();

  if (modalState !== 'minimized' || !playback) return null;
  const pct = playback.totalEvents
    ? Math.min(100, (playback.currentEventIndex / playback.totalEvents) * 100)
    : 0;
  const running = playback.status === 'running';

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <span style={{ color: '#a78bfa' }}>▶</span>
        <span className={styles.title}>{selectedCaseId}</span>
        <span style={{ opacity: 0.6 }}>
          {playback.currentEventIndex}/{playback.totalEvents}
        </span>
      </div>
      <div className={styles.progress}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.row} style={{ marginBlockEnd: 0 }}>
        <ActionIcon icon={running ? Pause : Play} size="small" onClick={running ? pause : resume} />
        <ActionIcon icon={SkipForward} size="small" title="next step" onClick={stepStep} />
        <span style={{ flex: 1 }} />
        <ActionIcon
          icon={Maximize2}
          size="small"
          title="expand"
          onClick={() => setModalState('open')}
        />
        <ActionIcon icon={X} size="small" title="stop" onClick={stop} />
      </div>
    </div>
  );
});

MiniBar.displayName = 'AgentMockMiniBar';
