'use client';

import { useVideo } from '@lobehub/ui';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { TimedNote } from './chapters';
import { styles } from './styles';

export interface VideoLoop {
  end: number;
  start: number;
}

interface RangeLaneProps {
  notes: TimedNote[];
  onRange: (range: VideoLoop | null) => void;
  onSeek: (seconds: number) => void;
  range: VideoLoop | null;
}

/** The lane under the rail: drag to select a span, and see the spans notes cover. */
export const RangeLane = ({ notes, onRange, onSeek, range }: RangeLaneProps) => {
  const { t } = useTranslation('verify');
  const duration = useVideo((state) => (Number.isFinite(state.duration) ? state.duration : 0));
  const pct = (seconds: number) => `${(duration ? seconds / duration : 0) * 100}%`;

  const timeAt = (element: HTMLElement, clientX: number) => {
    const box = element.getBoundingClientRect();
    return Math.min(Math.max((clientX - box.left) / box.width, 0), 1) * duration;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const element = event.currentTarget;
    const anchor = timeAt(element, event.clientX);
    onRange({ end: anchor, start: anchor });
    element.setPointerCapture?.(event.pointerId);
    const move = (next: PointerEvent) => {
      const seconds = timeAt(element, next.clientX);
      onRange({ end: Math.max(anchor, seconds), start: Math.min(anchor, seconds) });
    };
    const up = (next: PointerEvent) => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      const seconds = timeAt(element, next.clientX);
      // A click, not a drag, clears the span rather than leaving a sliver.
      if (Math.abs(seconds - anchor) < 0.15) onRange(null);
      else onSeek(Math.min(anchor, seconds));
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
  };

  return (
    <div className={styles.lane} onPointerDown={onPointerDown}>
      {!range && <span className={styles.laneLabel}>{t('acceptance.video.rangeLane')}</span>}
      {notes
        .filter((note) => note.end !== undefined)
        .map((note) => (
          <div
            className={styles.noteSpan}
            key={`span-${note.key}`}
            style={{ left: pct(note.start), top: 4, width: pct(note.end! - note.start) }}
          />
        ))}
      {range && (
        <div
          className={styles.rangeBand}
          style={{ left: pct(range.start), width: pct(range.end - range.start) }}
        />
      )}
    </div>
  );
};
