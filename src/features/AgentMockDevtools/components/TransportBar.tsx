import type { SpeedMultiplier } from '@lobechat/agent-mock';
import { ActionIcon, Dropdown, Flexbox, Segmented, toast } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Pause, Play, Repeat, RotateCcw, SkipForward } from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';

import { useAgentMockPlayer } from '../hooks/useAgentMockPlayer';
import { useAgentMockReplayTarget } from '../hooks/useAgentMockReplayTarget';
import { useMockCases } from '../hooks/useMockCases';
import { useAgentMockStore } from '../store/agentMockStore';

const SPEED_OPTIONS: Array<{ label: string; value: SpeedMultiplier }> = [
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '5×', value: 5 },
  { label: '∞', value: 'instant' },
];

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  loopOn: css`
    color: ${cssVar.colorBgContainer};
    background: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorBgContainer};
      background: ${cssVar.colorText};
    }
  `,
  progress: css`
    cursor: pointer;

    flex: 1;

    height: 6px;
    border-radius: 3px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressFill: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorText};
    transition: width 0.16s linear;
  `,
  progressTrack: css`
    position: relative;
    overflow: hidden;
    height: 100%;
  `,
  time: css`
    min-width: 64px;

    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorTextSecondary};
    text-align: end;
  `,
}));

export const TransportBar = memo(() => {
  const { all } = useMockCases();
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const playback = useAgentMockStore((s) => s.playback);
  const speed = useAgentMockStore((s) => s.speed);
  const setSpeedStore = useAgentMockStore((s) => s.setSpeed);
  const loop = useAgentMockStore((s) => s.loop);
  const setLoop = useAgentMockStore((s) => s.setLoop);

  const { pause, resume, seekToEventIndex, setSpeed, start, stepEvent, stepStep, stepTool } =
    useAgentMockPlayer();
  const resolveReplayTarget = useAgentMockReplayTarget();

  const trackRef = useRef<HTMLDivElement | null>(null);

  const selected = all.find((c) => c.id === selectedCaseId);
  const disabled = !selected;

  const status = playback?.status;
  const running = status === 'running';
  const paused = status === 'paused';
  const idleOrComplete = !playback || status === 'idle' || status === 'complete';

  const launchCase = useCallback(() => {
    if (!selected) return;
    const { agentId, threadId, topicId } = resolveReplayTarget();
    if (!agentId) {
      toast.warning('Open an agent conversation first.');
      return;
    }
    if (!topicId) {
      toast.warning('Open a topic before playing a mock case.');
      return;
    }
    start({ agentId, case: selected, threadId, topicId });
  }, [resolveReplayTarget, selected, start]);

  const handlePlay = useCallback(() => {
    if (idleOrComplete) {
      launchCase();
      return;
    }
    if (paused) resume();
    else if (running) pause();
  }, [idleOrComplete, launchCase, paused, pause, resume, running]);

  const handleReplay = useCallback(() => {
    if (!selected) return;
    if (playback && status !== 'idle') {
      seekToEventIndex(0);
    }
    launchCase();
  }, [launchCase, playback, seekToEventIndex, selected, status]);

  const stepMenu = useMemo(
    () => [
      { key: 'event', label: 'Next event', onClick: stepEvent },
      { key: 'step', label: 'Next step', onClick: stepStep },
      { key: 'tool', label: 'Next tool', onClick: stepTool },
    ],
    [stepEvent, stepStep, stepTool],
  );

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!playback || playback.totalEvents === 0) return;
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const idx = Math.round(ratio * playback.totalEvents);
      seekToEventIndex(idx);
    },
    [playback, seekToEventIndex],
  );

  const pct = playback?.totalEvents
    ? Math.min(100, (playback.currentEventIndex / playback.totalEvents) * 100)
    : 0;

  const elapsed = playback ? `${(playback.elapsedMs / 1000).toFixed(1)}s` : '0.0s';
  const total = playback ? `${(playback.totalDurationMs / 1000).toFixed(1)}s` : '0.0s';

  const playIcon = running ? Pause : Play;

  return (
    <Flexbox horizontal align="center" className={styles.bar} gap={12}>
      <ActionIcon
        disabled={disabled}
        icon={playIcon}
        size="small"
        title={running ? 'Pause' : paused ? 'Resume' : 'Play'}
        onClick={handlePlay}
      />
      <Dropdown
        disabled={disabled}
        placement="topLeft"
        menu={{
          items: stepMenu.map(({ key, label }) => ({ key, label })),
          onClick: ({ key }) => stepMenu.find((m) => m.key === key)?.onClick(),
        }}
      >
        <ActionIcon disabled={disabled} icon={SkipForward} size="small" title="Step" />
      </Dropdown>
      <ActionIcon
        disabled={disabled}
        icon={RotateCcw}
        size="small"
        title="Replay from start"
        onClick={handleReplay}
      />
      <ActionIcon
        active={loop}
        aria-pressed={loop}
        className={loop ? styles.loopOn : undefined}
        icon={Repeat}
        size="small"
        title={loop ? 'Loop on' : 'Loop off'}
        onClick={() => setLoop(!loop)}
      />
      <div
        aria-valuemax={playback?.totalEvents ?? 0}
        aria-valuemin={0}
        aria-valuenow={playback?.currentEventIndex ?? 0}
        className={styles.progress}
        ref={trackRef}
        role="slider"
        tabIndex={0}
        onClick={handleProgressClick}
      >
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className={styles.time}>
        {elapsed} / {total}
      </span>
      <Segmented
        disabled={disabled}
        options={SPEED_OPTIONS}
        size="small"
        value={speed}
        onChange={(value) => {
          const next = value as SpeedMultiplier;
          setSpeedStore(next);
          setSpeed(next);
        }}
      />
    </Flexbox>
  );
});

TransportBar.displayName = 'AgentMockTransportBar';
