'use client';

import type { VerifyEvidenceChapter } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaimLabel } from './ClaimLabel';
import { CLAIM_COLOR, styles } from './styles';
import type { VideoLoop } from './useVideoClock';
import { claimsOf, formatVideoTime, stepAt, stepsOf } from './videoTime';

/** A reviewer note as the timeline sees it: a moment, or a span. */
export interface TimelineNote {
  comment?: string;
  end?: number;
  key: number | string;
  start: number;
}

/** Hovering within this share of the track snaps to a marker's own frame. */
const SNAP_RATIO = 0.012;

interface HoverState {
  claim?: VerifyEvidenceChapter;
  comment?: string;
  step?: string;
  time: number;
  x: number;
}

/**
 * The frame under the pointer, painted from a hidden second `<video>`: seeking
 * the one on screen would move the playhead the reviewer is holding. Seeks
 * queue behind each other so a fast sweep never stalls on stale frames.
 */
const HoverPreview = ({ claim, comment, src, step, time, x }: HoverState & { src: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLVideoElement>(null);
  const pending = useRef<number | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const paint = () => {
      const canvas = canvasRef.current;
      canvas?.getContext('2d')?.drawImage(probe, 0, 0, canvas.width, canvas.height);
      busy.current = false;
      if (pending.current === null) return;
      busy.current = true;
      probe.currentTime = pending.current;
      pending.current = null;
    };
    probe.addEventListener('seeked', paint);
    return () => probe.removeEventListener('seeked', paint);
  }, []);

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    if (busy.current) {
      pending.current = time;
      return;
    }
    busy.current = true;
    probe.currentTime = time;
  }, [time]);

  return (
    <div className={styles.preview} style={{ left: x }}>
      <video muted preload={'auto'} ref={probeRef} src={src} style={{ display: 'none' }} />
      <canvas height={99} ref={canvasRef} width={176} />
      <div className={styles.previewMeta}>
        <span className={styles.mono}>{formatVideoTime(time)}</span>
        {step && <span style={{ color: '#999' }}> · {step}</span>}
        {claim && (
          <div>
            <ClaimLabel kind={claim.kind} style={{ marginInlineEnd: 6 }} />
            {claim.note}
          </div>
        )}
        {comment && <div style={{ color: '#ffb4ab' }}>{comment}</div>}
      </div>
    </div>
  );
};

interface VideoTimelineProps {
  activeNoteKey?: number | string;
  chapters: VerifyEvidenceChapter[];
  duration: number;
  notes: TimelineNote[];
  onClaimClick: (claim: VerifyEvidenceChapter) => void;
  onNoteClick: (note: TimelineNote) => void;
  /** Present in review: the lane below the track selects a span. */
  onRange?: (range: VideoLoop | null) => void;
  onSeek: (seconds: number) => void;
  range?: VideoLoop | null;
  src: string;
  time: number;
}

/**
 * The scrubber and everything pinned to it: the agent's steps as ticks, its
 * claims as dots (check) and diamonds (flag) above the rail, and reviewer notes
 * as red marks on it. In review a lane below the rail selects a span.
 */
export const VideoTimeline = ({
  activeNoteKey,
  chapters,
  duration,
  notes,
  onClaimClick,
  onNoteClick,
  onRange,
  onSeek,
  range,
  src,
  time,
}: VideoTimelineProps) => {
  const { t } = useTranslation('verify');
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const pct = (seconds: number) => `${(duration ? seconds / duration : 0) * 100}%`;

  const timeAt = (element: HTMLElement, clientX: number) => {
    const box = element.getBoundingClientRect();
    return Math.min(Math.max((clientX - box.left) / box.width, 0), 1) * duration;
  };

  /** Pointer-captured drag: the gesture keeps tracking outside the element. */
  const drag = (
    event: ReactPointerEvent<HTMLDivElement>,
    onMove: (seconds: number) => void,
    onEnd?: (seconds: number) => void,
  ) => {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => onMove(timeAt(element, next.clientX));
    const up = (next: PointerEvent) => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      onEnd?.(timeAt(element, next.clientX));
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
  };

  const onTrackDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onSeek(timeAt(event.currentTarget, event.clientX));
    drag(event, onSeek);
  };

  const onLaneDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onRange) return;
    const anchor = timeAt(event.currentTarget, event.clientX);
    onRange({ end: anchor, start: anchor });
    drag(
      event,
      (seconds) => onRange({ end: Math.max(anchor, seconds), start: Math.min(anchor, seconds) }),
      (seconds) => {
        // A click, not a drag, clears the span rather than leaving a sliver.
        if (Math.abs(seconds - anchor) < 0.15) onRange(null);
        else onSeek(Math.min(anchor, seconds));
      },
    );
  };

  const onHover = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || !duration) return;
    const box = track.getBoundingClientRect();
    const seconds = timeAt(track, event.clientX);
    const snap = duration * SNAP_RATIO;
    const note = notes.find((item) => Math.abs(item.start - seconds) < snap);
    const claim = note
      ? undefined
      : claimsOf(chapters).find((item) => Math.abs(item.t - seconds) < snap);
    setHover({
      claim,
      comment: note?.comment,
      step: stepAt(chapters, seconds)?.label,
      time: note?.start ?? claim?.t ?? seconds,
      x: Math.min(Math.max(event.clientX - box.left, 88), box.width - 88),
    });
  };

  const span = range && (
    <div
      className={styles.rangeBand}
      style={{ left: pct(range.start), width: pct(range.end - range.start) }}
    />
  );

  return (
    <div className={styles.timeline}>
      {hover && <HoverPreview {...hover} src={src} />}
      <div
        aria-label={t('acceptance.video.seek')}
        aria-valuemax={Math.round(duration)}
        aria-valuemin={0}
        aria-valuenow={Math.round(time)}
        className={styles.track}
        ref={trackRef}
        role={'slider'}
        onPointerDown={onTrackDown}
        onPointerLeave={() => setHover(null)}
        onPointerMove={onHover}
      >
        <div className={styles.rail} />
        <div className={styles.played} style={{ width: pct(time) }} />
        {stepsOf(chapters).map((step) =>
          step.t > 0 ? (
            <div className={styles.stepTick} key={`step-${step.t}`} style={{ left: pct(step.t) }} />
          ) : null,
        )}
        {span}
        {notes
          .filter((note) => note.end !== undefined)
          .map((note) => (
            <div
              className={styles.noteSpan}
              key={`span-${note.key}`}
              style={{ left: pct(note.start), width: pct(note.end! - note.start) }}
            />
          ))}
        <div className={styles.head} style={{ left: pct(time) }} />
        {claimsOf(chapters).map((claim, index) => (
          <button
            aria-label={`${t(`acceptance.video.claim.${claim.kind}`)} ${formatVideoTime(claim.t)}: ${claim.note}`}
            className={styles.claimMark}
            key={`claim-${claim.kind}-${claim.t}-${index}`}
            style={{ background: CLAIM_COLOR[claim.kind], left: pct(claim.t) }}
            type={'button'}
            // The press must not also scrub the track; the click (pointer, Enter
            // or Space) is what seeks, so the marker works from the keyboard.
            onClick={() => onClaimClick(claim)}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ))}
        {notes.map((note) => (
          <button
            aria-label={`${formatVideoTime(note.start)} ${note.comment ?? ''}`}
            className={cx(styles.noteMark, activeNoteKey === note.key && styles.noteMarkActive)}
            key={`note-${note.key}`}
            style={{ left: pct(note.start) }}
            type={'button'}
            // The press must not also scrub the track; the click (pointer, Enter
            // or Space) is what seeks, so the marker works from the keyboard.
            onClick={() => onNoteClick(note)}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ))}
      </div>
      {onRange && (
        <div className={styles.lane} onPointerDown={onLaneDown}>
          {!range && <span className={styles.laneLabel}>{t('acceptance.video.rangeLane')}</span>}
          {span}
        </div>
      )}
    </div>
  );
};
