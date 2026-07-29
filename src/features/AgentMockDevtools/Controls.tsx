import { ActionIcon, Flexbox, toast } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Pause, Play, Repeat, RotateCcw, SkipForward, Square } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { CaseTrigger } from './CaseTrigger';
import { useAgentMockPlayer } from './hooks/useAgentMockPlayer';
import { useAgentMockReplayTarget } from './hooks/useAgentMockReplayTarget';
import { useMockCases } from './hooks/useMockCases';
import { useAgentMockStore } from './store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  counter: css`
    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorTextSecondary};
  `,
  progress: css`
    touch-action: none;
    cursor: pointer;

    display: flex;
    align-items: center;

    height: 14px;

    &:hover .agent-mock-progress-track {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  progressFill: css`
    pointer-events: none;

    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;

    height: 100%;
    border-radius: inherit;

    background: ${cssVar.colorText};

    transition: width 0.16s linear;
  `,
  progressTrack: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    height: 4px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressTrackScrubbing: css`
    background: ${cssVar.colorFillTertiary} !important;
  `,
}));

export const Controls = memo(() => {
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const playback = useAgentMockStore((s) => s.playback);
  const loop = useAgentMockStore((s) => s.loop);
  const setLoop = useAgentMockStore((s) => s.setLoop);

  const { all } = useMockCases();
  const selected = all.find((c) => c.id === selectedCaseId);
  const { pause, resume, seekToEventIndex, start, stepEvent, stop } = useAgentMockPlayer();
  const resolveReplayTarget = useAgentMockReplayTarget();

  const status = playback?.status;
  const running = status === 'running';
  const paused = status === 'paused';
  const idleOrComplete = !playback || status === 'idle' || status === 'complete';
  const disabled = !selected;
  const stoppable = playback != null && status !== 'idle';

  const progressRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

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
  }, [idleOrComplete, launchCase, pause, paused, resume, running]);

  const handleReplay = useCallback(() => {
    if (!selected) return;
    if (playback && status !== 'idle') seekToEventIndex(0);
    launchCase();
  }, [launchCase, playback, seekToEventIndex, selected, status]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const total = playback?.totalEvents;
      if (!total) return;
      const el = progressRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      seekToEventIndex(Math.round(ratio * total));
    },
    [playback?.totalEvents, seekToEventIndex],
  );

  const handleScrubStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!playback || !playback.totalEvents) return;
      if (e.button !== 0) return;
      e.preventDefault();
      setScrubbing(true);
      seekFromClientX(e.clientX);
    },
    [playback, seekFromClientX],
  );

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: PointerEvent) => seekFromClientX(e.clientX);
    const onUp = () => setScrubbing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [scrubbing, seekFromClientX]);

  const pct = playback?.totalEvents
    ? Math.min(100, (playback.currentEventIndex / playback.totalEvents) * 100)
    : 0;

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8}>
        <CaseTrigger placement={'topLeft'} />
        <span style={{ flex: 1 }} />
        <span className={styles.counter}>
          {playback ? `${playback.currentEventIndex}/${playback.totalEvents}` : '—'}
        </span>
      </Flexbox>
      <div
        aria-valuemax={playback?.totalEvents ?? 0}
        aria-valuemin={0}
        aria-valuenow={playback?.currentEventIndex ?? 0}
        className={styles.progress}
        ref={progressRef}
        role={'slider'}
        tabIndex={0}
        onPointerDown={handleScrubStart}
      >
        <div
          className={`agent-mock-progress-track ${styles.progressTrack} ${
            scrubbing ? styles.progressTrackScrubbing : ''
          }`}
        >
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <Flexbox horizontal align={'center'} gap={4}>
        <ActionIcon
          disabled={disabled}
          icon={running ? Pause : Play}
          size={'small'}
          title={running ? 'Pause' : paused ? 'Resume' : 'Play'}
          onClick={handlePlay}
        />
        <ActionIcon
          disabled={disabled}
          icon={SkipForward}
          size={'small'}
          title={'Next event'}
          onClick={stepEvent}
        />
        <ActionIcon
          disabled={disabled}
          icon={RotateCcw}
          size={'small'}
          title={'Replay from start'}
          onClick={handleReplay}
        />
        <ActionIcon
          active={loop}
          aria-pressed={loop}
          icon={Repeat}
          size={'small'}
          title={loop ? 'Loop on' : 'Loop off'}
          onClick={() => setLoop(!loop)}
        />
        <ActionIcon
          danger
          disabled={!stoppable}
          icon={Square}
          size={'small'}
          title={'Stop playback'}
          onClick={stop}
        />
        <span style={{ flex: 1 }} />
        <span className={styles.counter}>{selected ? selected.name : 'No case selected'}</span>
      </Flexbox>
    </Flexbox>
  );
});

Controls.displayName = 'AgentMockControls';
