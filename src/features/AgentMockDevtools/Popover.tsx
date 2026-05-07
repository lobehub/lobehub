import { ActionIcon, Button, Flexbox, toast } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  GripHorizontal,
  Maximize2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SkipForward,
  Square,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { CaseTrigger } from './CaseTrigger';
import { useAgentMockPlayer } from './hooks/useAgentMockPlayer';
import { useAgentMockReplayTarget } from './hooks/useAgentMockReplayTarget';
import { useMockCases } from './hooks/useMockCases';
import { useAgentMockStore } from './store/agentMockStore';

const POPOVER_WIDTH = 320;
const PANEL_HEIGHT_FALLBACK = 200;
const VIEWPORT_INSET = 8;
const POSITION_STORAGE_KEY = 'LOBE_AGENT_MOCK_POPOVER_POS';

interface PanelPosition {
  x: number;
  y: number;
}

const readPersistedPosition = (): PanelPosition | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelPosition>;
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    return null;
  }
};

const writePersistedPosition = (pos: PanelPosition | null) => {
  if (typeof localStorage === 'undefined') return;
  if (!pos) {
    localStorage.removeItem(POSITION_STORAGE_KEY);
    return;
  }
  localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
};

const clampToViewport = (pos: PanelPosition, width: number, height: number): PanelPosition => {
  if (typeof window === 'undefined') return pos;
  const maxX = Math.max(VIEWPORT_INSET, window.innerWidth - width - VIEWPORT_INSET);
  const maxY = Math.max(VIEWPORT_INSET, window.innerHeight - height - VIEWPORT_INSET);
  return {
    x: Math.min(Math.max(VIEWPORT_INSET, pos.x), maxX),
    y: Math.min(Math.max(VIEWPORT_INSET, pos.y), maxY),
  };
};

const styles = createStaticStyles(({ css }) => ({
  body: css`
    padding: 12px;
    padding-block-start: 0;
  `,
  closeBtn: css`
    cursor: pointer;

    width: 22px;
    height: 22px;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  counter: css`
    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorTextSecondary};
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorFillTertiary};
  `,
  grip: css`
    cursor: grab;
    user-select: none;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 22px;
    border-radius: 4px;

    color: ${cssVar.colorTextQuaternary};

    transition: color 120ms ease;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }

    &:active {
      cursor: grabbing;
    }
  `,
  gripDragging: css`
    cursor: grabbing;
    color: ${cssVar.colorText};
  `,
  header: css`
    padding-block: 8px;
    padding-inline: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  panel: css`
    position: fixed;
    z-index: 1099;

    overflow: hidden;

    width: ${POPOVER_WIDTH}px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background: ${cssVar.colorBgElevated};
    box-shadow: 0 12px 32px rgb(0 0 0 / 12%);
  `,
  progress: css`
    touch-action: none;
    cursor: pointer;

    display: flex;
    align-items: center;

    height: 14px;
    margin-block-end: 8px;

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

export const Popover = memo(() => {
  const popoverOpen = useAgentMockStore((s) => s.popoverOpen);
  const modalOpen = useAgentMockStore((s) => s.modalOpen);
  const setPopoverOpen = useAgentMockStore((s) => s.setPopoverOpen);
  const setModalOpen = useAgentMockStore((s) => s.setModalOpen);
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

  const panelRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(() => readPersistedPosition());
  const [dragging, setDragging] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const dragOriginRef = useRef<{
    panelLeft: number;
    panelTop: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);

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

  const handleOpenDevtools = useCallback(() => {
    setModalOpen(true);
    setPopoverOpen(false);
  }, [setModalOpen, setPopoverOpen]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popoverOpen, setPopoverOpen]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const next: PanelPosition = {
        x: origin.panelLeft + (e.clientX - origin.pointerX),
        y: origin.panelTop + (e.clientY - origin.pointerY),
      };
      const height = panelRef.current?.offsetHeight ?? PANEL_HEIGHT_FALLBACK;
      setPosition(clampToViewport(next, POPOVER_WIDTH, height));
    };
    const onUp = () => {
      setDragging(false);
      dragOriginRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (dragging) return;
    writePersistedPosition(position);
  }, [dragging, position]);

  const handleDragStart = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (!panelRef.current) return;
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    dragOriginRef.current = {
      panelLeft: rect.left,
      panelTop: rect.top,
      pointerX: e.clientX,
      pointerY: e.clientY,
    };
    setDragging(true);
  }, []);

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

  if (modalOpen || !popoverOpen) return null;

  const pct = playback?.totalEvents
    ? Math.min(100, (playback.currentEventIndex / playback.totalEvents) * 100)
    : 0;

  const positionStyle: React.CSSProperties = position
    ? { insetBlockStart: position.y, insetInlineStart: position.x }
    : { insetBlockEnd: 64, insetInlineEnd: 16 };

  return (
    <div
      aria-label="Agent Mock controls"
      className={styles.panel}
      ref={panelRef}
      role="dialog"
      style={positionStyle}
    >
      <Flexbox horizontal align="center" className={styles.header} gap={6}>
        <span
          aria-label="Drag"
          className={`${styles.grip} ${dragging ? styles.gripDragging : ''}`}
          role="presentation"
          onPointerDown={handleDragStart}
        >
          <GripHorizontal size={14} />
        </span>
        <CaseTrigger placement="topRight" />
        <span style={{ flex: 1 }} />
        <span className={styles.counter}>
          {playback ? `${playback.currentEventIndex}/${playback.totalEvents}` : '—'}
        </span>
        <span
          aria-label="Close"
          className={styles.closeBtn}
          role="button"
          style={{ alignItems: 'center', display: 'inline-flex', justifyContent: 'center' }}
          tabIndex={0}
          onClick={() => setPopoverOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setPopoverOpen(false);
            }
          }}
        >
          <X size={14} />
        </span>
      </Flexbox>
      <div className={styles.body}>
        <div
          aria-valuemax={playback?.totalEvents ?? 0}
          aria-valuemin={0}
          aria-valuenow={playback?.currentEventIndex ?? 0}
          className={styles.progress}
          ref={progressRef}
          role="slider"
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
        <Flexbox horizontal align="center" gap={4}>
          <ActionIcon
            disabled={disabled}
            icon={running ? Pause : Play}
            size="small"
            title={running ? 'Pause' : paused ? 'Resume' : 'Play'}
            onClick={handlePlay}
          />
          <ActionIcon
            disabled={disabled}
            icon={SkipForward}
            size="small"
            title="Next event"
            onClick={stepEvent}
          />
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
            icon={Repeat}
            size="small"
            title={loop ? 'Loop on' : 'Loop off'}
            onClick={() => setLoop(!loop)}
          />
          <ActionIcon
            danger
            disabled={!stoppable}
            icon={Square}
            size="small"
            title="Stop playback"
            onClick={handleStop}
          />
          <span style={{ flex: 1 }} />
          <Button
            icon={<Maximize2 size={12} />}
            size="small"
            type="primary"
            onClick={handleOpenDevtools}
          >
            Open DevTools
          </Button>
        </Flexbox>
      </div>
      <Flexbox horizontal align="center" className={styles.footer} gap={8} justify="space-between">
        <span className={styles.counter}>{selected ? selected.name : 'No case selected'}</span>
      </Flexbox>
    </div>
  );
});

Popover.displayName = 'AgentMockPopover';
