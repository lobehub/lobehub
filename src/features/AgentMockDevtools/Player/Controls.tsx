import type { SpeedMultiplier } from '@lobechat/agent-mock';
import { Button } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { useAgentMockPlayer } from '../hooks/useAgentMockPlayer';
import { useMockCases } from '../hooks/useMockCases';
import { useAgentMockStore } from '../store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  block: css`
    margin-block-end: 16px;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background: ${cssVar.colorFillAlter};
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
    margin-block-end: 10px;

    &:last-child {
      margin-block-end: 0;
    }
  `,
  speedGroup: css`
    overflow: hidden;
    display: inline-flex;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;
  `,
  speedBtn: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: none;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11px;

    background: ${cssVar.colorBgContainer};

    &:last-child {
      border-inline-end: none;
    }
  `,
  speedActive: css`
    color: #fff;
    background: ${cssVar.colorPrimary};
  `,
}));

const SPEEDS: SpeedMultiplier[] = [0.5, 1, 2, 5, 'instant'];

export const Controls = memo(() => {
  const { all } = useMockCases();
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const playback = useAgentMockStore((s) => s.playback);
  const speed = useAgentMockStore((s) => s.speed);
  const setSpeedStore = useAgentMockStore((s) => s.setSpeed);

  const { start, pause, resume, stop, stepEvent, stepStep, stepTool, setSpeed } =
    useAgentMockPlayer();

  const running = playback?.status === 'running';
  const paused = playback?.status === 'paused';
  const idleOrComplete = !playback || playback.status === 'idle' || playback.status === 'complete';

  const handlePlay = () => {
    if (idleOrComplete) {
      const c = all.find((x) => x.id === selectedCaseId);
      if (!c) return;
      const topicId = useAgentMockStore.getState().activeMockTopicId;
      if (!topicId) {
        alert('Choose a target topic first (TargetPicker)');
        return;
      }
      // Note: agentId is hardcoded to a placeholder here; in v2 the TargetPicker
      // should provide it from the active session's agentId.
      start({
        agentId: 'mock-agent',
        case: c,
        topicId,
        assistantMessageId: `mock-asst-${Date.now()}`,
        sessionId: 'mock-session',
      });
    } else if (paused) {
      resume();
    } else if (running) {
      pause();
    }
  };

  return (
    <div className={styles.block}>
      <div className={styles.row}>
        <Button type="primary" onClick={handlePlay}>
          {running ? '⏸ Pause' : paused ? '▶ Resume' : '▶ Play'}
        </Button>
        <Button onClick={stop}>■ Stop</Button>
        <span style={{ width: 8 }} />
        <Button size="small" onClick={stepEvent}>
          → next event
        </Button>
        <Button size="small" onClick={stepStep}>
          ⤇ next step
        </Button>
        <Button size="small" onClick={stepTool}>
          ⏭ next tool
        </Button>
      </div>
      <div className={styles.row}>
        <span style={{ fontSize: 11, color: cssVar.colorTextTertiary }}>Speed</span>
        <div className={styles.speedGroup}>
          {SPEEDS.map((s) => (
            <button
              className={`${styles.speedBtn} ${speed === s ? styles.speedActive : ''}`}
              key={String(s)}
              type="button"
              onClick={() => {
                setSpeedStore(s);
                setSpeed(s);
              }}
            >
              {s === 'instant' ? '∞' : `${s}×`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

Controls.displayName = 'AgentMockControls';
