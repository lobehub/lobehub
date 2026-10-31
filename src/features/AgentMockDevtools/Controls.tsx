import { ActionIcon, Flexbox, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Pause, Play, Repeat, RotateCcw, SkipForward, Square } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { sx } from '@/styles/sx';

import { CaseTrigger } from './CaseTrigger';
import { useAgentMockPlayer } from './hooks/useAgentMockPlayer';
import { useAgentMockReplayTarget } from './hooks/useAgentMockReplayTarget';
import { useMockCases } from './hooks/useMockCases';
import { useAgentMockStore } from './store/agentMockStore';

const styles = stylex.create({
  actions: {
    flexShrink: 0,
    height: '40px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  controls: { display: 'flex', flexDirection: 'column', flexShrink: 0 },
  counter: {
    fontSize: '11px',
    fontFeatureSettings: "'tnum'",
    color: cssVar.colorTextSecondary,
  },
  progress: {
    touchAction: 'none',
    cursor: 'pointer',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    height: '28px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  progressFill: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlock: 0,
    insetInlineStart: 0,
    height: '100%',
    borderRadius: 'inherit',
    backgroundColor: cssVar.colorText,
    backgroundImage: 'none',
    transitionProperty: 'width',
    transitionDuration: '0.16s',
    transitionTimingFunction: 'linear',
  },
  progressTrack: {
    position: 'relative',
    overflow: 'hidden',
    flex: '1',
    height: '4px',
    borderRadius: '2px',
    backgroundColor: {
      default: cssVar.colorFillSecondary,
      [stylex.when.ancestor(':hover')]: cssVar.colorFillTertiary,
    },
    backgroundImage: 'none',
  },
  progressTrackScrubbing: { backgroundColor: cssVar.colorFillTertiary },
  selection: {
    flexShrink: 0,
    height: '44px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

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
    <div {...stylex.props(styles.controls)}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.selection).className}
        gap={8}
      >
        <CaseTrigger placement={'topLeft'} />
        <span style={{ flex: 1 }} />
        <span {...stylex.props(styles.counter)}>
          {playback ? `${playback.currentEventIndex}/${playback.totalEvents}` : '—'}
        </span>
      </Flexbox>
      <div
        aria-valuemax={playback?.totalEvents ?? 0}
        aria-valuemin={0}
        aria-valuenow={playback?.currentEventIndex ?? 0}
        {...stylex.props(styles.progress, stylex.defaultMarker())}
        ref={progressRef}
        role={'slider'}
        tabIndex={0}
        onPointerDown={handleScrubStart}
      >
        <div {...stylex.props(styles.progressTrack, scrubbing && styles.progressTrackScrubbing)}>
          <div {...sx([styles.progressFill], undefined, { width: `${pct}%` })} />
        </div>
      </div>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.actions).className}
        gap={4}
      >
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
        <span {...stylex.props(styles.counter)}>
          {selected ? selected.name : 'No case selected'}
        </span>
      </Flexbox>
    </div>
  );
});

Controls.displayName = 'AgentMockControls';
