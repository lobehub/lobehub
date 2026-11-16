'use client';

import type { VerifyEvidenceChapter } from '@lobechat/types';
import { useVideoState, type VideoPlayer, type VideoState } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { chapterScrubberStyles as styles } from './chapterScrubberStyles';
import {
  fanOutPins,
  type PinSlot,
  type ScrubberSegment,
  type StoryEntry,
  type StoryNote,
  toScrubberSegments,
} from './story';
import { CLAIM_COLOR } from './styles';
import { formatVideoTime } from './videoTime';

const GAP_PX = 4;
const PIN_EDGE_PX = 10;

const pinLeft = (slot: PinSlot, clampAlone: boolean) => {
  if (slot.before + slot.after === 0 && !clampAlone) return `${slot.percent}%`;
  return `clamp(${PIN_EDGE_PX + slot.before}px, calc(${slot.percent}% + ${slot.offset}px), calc(100% - ${
    PIN_EDGE_PX + slot.after
  }px))`;
};

interface ChapterScrubberProps<N extends StoryNote> {
  chapters: VerifyEvidenceChapter[];
  onPin: (entry: StoryEntry<N>) => void;
  player: VideoPlayer;
  range: { end: number; start: number } | null;
  story: StoryEntry<N>[];
}

export const ChapterScrubber = <N extends StoryNote>({
  chapters,
  onPin,
  player,
  range,
  story,
}: ChapterScrubberProps<N>) => {
  const { t } = useTranslation('verify');
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const duration = useVideoState(player, (state) =>
    Number.isFinite(state.duration) ? state.duration : 0,
  );
  const currentStart = useVideoState(player, (state) => state.activeSection?.start);

  useLayoutEffect(() => {
    const paint = (state: VideoState) => {
      root.current?.style.setProperty('--video-time', String(state.time));
      track.current?.setAttribute('aria-valuenow', String(Math.round(state.time)));
      track.current?.setAttribute(
        'aria-valuetext',
        [
          `${formatVideoTime(state.time)} / ${formatVideoTime(state.duration)}`,
          state.activeSection?.title,
        ]
          .filter(Boolean)
          .join(', '),
      );
    };
    paint(player.getState());
    return player.subscribe(paint);
  }, [player]);

  const segments: ScrubberSegment[] = toScrubberSegments(chapters, duration);
  const pct = (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0);
  const box = (segment: ScrubberSegment, index: number) => {
    const before = index === 0 ? 0 : GAP_PX / 2;
    const after = index === segments.length - 1 ? 0 : GAP_PX / 2;
    return {
      left: `calc(${pct(segment.start)}% + ${before}px)`,
      width: `calc(${pct(segment.end - segment.start)}% - ${before + after}px)`,
    };
  };

  const timeAt = (element: HTMLElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width) return 0;
    return Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1) * duration;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !duration) return;
    const element = event.currentTarget;
    player.seek(timeAt(element, event.clientX));
    element.setPointerCapture?.(event.pointerId);
    const move = (next: PointerEvent) => player.seek(timeAt(element, next.clientX));
    const up = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
  };

  const inside = (seconds: number) => duration > 0 && seconds >= 0 && seconds <= duration;
  const pinSlots = fanOutPins(
    story.filter((entry) => entry.type !== 'chapter' && inside(entry.time)),
    duration,
  );

  return (
    <div {...stylex.props(styles.root)} ref={root}>
      {story.map((entry) => {
        const slot = pinSlots.get(entry.id);
        if (!slot) return null;
        switch (entry.type) {
          case 'chapter': {
            return null;
          }
          case 'claim': {
            return (
              <button
                aria-label={`${t(`acceptance.video.claim.${entry.claim.kind}`)} ${formatVideoTime(entry.time)}`}
                key={entry.id}
                type={'button'}
                {...sx(styles.pin, styles.claimPin, { left: pinLeft(slot, false) })}
                onClick={() => onPin(entry)}
              >
                <span
                  {...stylex.props(
                    styles.claimDot,
                    styles.claimColor(CLAIM_COLOR[entry.claim.kind]),
                  )}
                />
              </button>
            );
          }
          case 'note': {
            return (
              <button
                key={entry.id}
                type={'button'}
                aria-label={t('acceptance.video.story.notePin', {
                  index: entry.index,
                  time: formatVideoTime(entry.time),
                })}
                {...sx(styles.pin, styles.notePin, { left: pinLeft(slot, true) })}
                onClick={() => onPin(entry)}
              >
                {entry.index}
              </button>
            );
          }
        }
      })}
      <div
        aria-label={t('acceptance.video.seek')}
        aria-valuemax={Math.round(duration)}
        aria-valuemin={0}
        ref={track}
        role={'slider'}
        tabIndex={0}
        {...stylex.props(styles.track)}
        onPointerDown={onPointerDown}
      >
        {segments.length === 0 && <div {...sx(styles.segment, { left: 0, width: '100%' })} />}
        {segments.map((segment, index) => (
          <div key={segment.start} {...sx(styles.segment, box(segment, index))}>
            <div
              {...sx(styles.played, {
                width: `calc(clamp(0, (var(--video-time, 0) - ${segment.start}) / ${
                  segment.end - segment.start
                }, 1) * 100%)`,
              })}
            />
          </div>
        ))}
        {story.map((entry) =>
          entry.type === 'note' && entry.note.end !== undefined && inside(entry.time) ? (
            <div
              key={entry.id}
              {...sx(styles.noteSpan, {
                left: `${pct(entry.time)}%`,
                width: `${pct(Math.min(entry.note.end, duration) - entry.time)}%`,
              })}
            />
          ) : null,
        )}
        {range && duration > 0 && (
          <div
            {...sx(styles.range, {
              left: `${pct(range.start)}%`,
              width: `${pct(Math.min(range.end, duration) - range.start)}%`,
            })}
          />
        )}
        {duration > 0 && (
          <div {...sx(styles.head, { left: `calc(var(--video-time, 0) / ${duration} * 100%)` })} />
        )}
      </div>
      {segments.some((segment) => segment.label) && (
        <div {...stylex.props(styles.labels)}>
          {segments.map((segment, index) =>
            segment.label ? (
              <button
                key={segment.start}
                type={'button'}
                {...sx(
                  styles.label,
                  segment.start === currentStart && styles.labelCurrent,
                  box(segment, index),
                )}
                onClick={() => player.seek(segment.start)}
              >
                {segment.label}
              </button>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
};
