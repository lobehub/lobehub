'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation, VerifyEvidenceChapter } from '@lobechat/types';
import {
  createStaticStyles,
  cssVar,
  cx,
  useVideo,
  useVideoPlayer,
  useVideoState,
  Video,
  type VideoPlayer,
} from '@lobehub/ui';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DraftAnnotationEntry } from '../../Review/rejectDraft';
import { type ClaimMarker, noteKeyOf, toClaimMarkers, toNoteMarkers, toSections } from './chapters';
import { readStoredRate, storeRate } from './playbackRate';
import { RangeLane, type VideoLoop } from './RangeLane';
import { ReviewTools } from './ReviewTools';
import { styles } from './styles';
import { DraftRegion, FrameRegions } from './VideoChrome';
import { disputesClaim, formatVideoTime, frameOf } from './videoTime';

type Rect = AcceptanceReviewAnnotation['rect'];

const RATES = [0.5, 1, 1.5, 2];

const local = createStaticStyles(({ css }) => ({
  /** The frame shrinks to the room left by the timeline and the tools. */
  fit: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    min-height: 0;
  `,
}));

export interface VideoReviewStageHandle {
  /** Pause on a note's frame (and select its span) — the notes panel's "go there". */
  focusNote: (note: DraftAnnotationEntry) => void;
}

interface VideoReviewStageProps {
  chapters: VerifyEvidenceChapter[];
  handleRef?: RefObject<VideoReviewStageHandle | null>;
  notes: DraftAnnotationEntry[];
  onAddNote: (note: {
    disputes?: AcceptanceReviewAnnotation['disputes'];
    rect?: Rect;
    time: NonNullable<AcceptanceReviewAnnotation['time']>;
  }) => void;
  /** Re-sign the file link; resolves to the fresh URL, if the evidence still exists. */
  onRefreshSource?: () => Promise<string | undefined>;
  onSelectNote: (key: number) => void;
  src: string;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));

const playbackKey = (event: KeyboardEvent, player: VideoPlayer) => {
  // A focused button owns Space and Enter — they must activate it, not play.
  if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter'))
    return false;
  const { rate, time } = player.getState();
  const nextRate = (direction: 1 | -1) => {
    const index = RATES.indexOf(rate);
    player.setRate(
      RATES[Math.min(Math.max((index === -1 ? 1 : index) + direction, 0), RATES.length - 1)],
    );
  };
  switch (event.key.toLowerCase()) {
    case ' ':
    case 'k': {
      player.toggle();
      return true;
    }
    case ',': {
      player.step(-1);
      return true;
    }
    case '.': {
      player.step(1);
      return true;
    }
    case 'arrowleft': {
      player.seek(time - (event.shiftKey ? 5 : 1));
      return true;
    }
    case 'arrowright': {
      player.seek(time + (event.shiftKey ? 5 : 1));
      return true;
    }
    case 'j': {
      nextRate(-1);
      return true;
    }
    case 'l': {
      nextRate(1);
      return true;
    }
    default: {
      return false;
    }
  }
};

const Hint = ({ drafting, flash }: { drafting: boolean; flash: string | null }) => {
  const { t } = useTranslation('verify');
  const paused = useVideo((state) => state.paused);
  const frame = useVideo((state) => (state.paused ? frameOf(state.time) : -1));
  const hint =
    flash ??
    (drafting
      ? null
      : paused
        ? t('acceptance.video.hintPaused', { frame })
        : t('acceptance.video.hintPlaying'));
  return hint ? <div className={styles.hint}>{hint}</div> : null;
};

/**
 * Where a video is rejected. Pressing on the picture pauses on the frame being
 * shown and draws a region on it; M marks the frame without a region; the lane
 * under the timeline (or I / O) selects a span that loops while it is judged;
 * and an agent claim captioned on screen can be disputed in one click.
 */
export const VideoReviewStage = memo<VideoReviewStageProps>(
  ({ chapters, handleRef, notes, onAddNote, onRefreshSource, onSelectNote, src: initialSrc }) => {
    const { t } = useTranslation('verify');
    const player = useVideoPlayer();
    // The modal holds the link it opened with; a re-signed one replaces it here.
    const [src, setSrc] = useState(initialSrc);
    const [range, setRange] = useState<VideoLoop | null>(null);
    const [loop, setLoop] = useState(true);
    const [draft, setDraft] = useState<Rect | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [defaultRate] = useState(readStoredRate);
    const ready = useVideoState(player, (state) => state.status === 'ready');
    const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const showFlash = (text: string) => {
      setFlash(text);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 1400);
    };
    useEffect(() => () => clearTimeout(flashTimer.current), []);

    const loopRange = loop ? range : null;
    useEffect(() => {
      if (!loopRange) return;
      return player.subscribe((state) => {
        if (!state.paused && state.time >= loopRange.end) player.seek(loopRange.start);
      });
    }, [player, loopRange]);

    const timed = useMemo(() => notes.filter((note) => note.time), [notes]);
    const timedNotes = useMemo(
      () =>
        timed.map((note) => ({
          comment: note.comment,
          end: note.time!.end,
          key: note.key,
          start: note.time!.start,
        })),
      [timed],
    );
    const sections = useMemo(() => toSections(chapters), [chapters]);
    const markers = useMemo(
      () => [
        ...toClaimMarkers(chapters, (kind) => t(`acceptance.video.claim.${kind}`)),
        ...toNoteMarkers(timedNotes),
      ],
      [chapters, t, timedNotes],
    );
    const regions = useMemo(
      () =>
        timed
          .filter((note) => !isFullFrameRect(note.rect))
          .map((note) => ({
            comment: note.comment,
            key: note.key,
            rect: note.rect,
            start: note.time!.start,
          })),
      [timed],
    );

    const focusNote = (note: DraftAnnotationEntry) => {
      if (!note.time) return;
      player.pause();
      player.seek(note.time.start);
      setRange(note.time.end === undefined ? null : { end: note.time.end, start: note.time.start });
      onSelectNote(note.key);
    };
    useImperativeHandle(handleRef, () => ({ focusNote }));

    const markFrame = () => {
      const start = player.getState().time;
      player.pause();
      onAddNote({ time: { start } });
    };

    const commentRange = () => {
      if (!range) return;
      onAddNote({ time: { end: range.end, start: range.start } });
      setRange(null);
    };

    // The modal is the review: keys act whenever the reviewer is not typing.
    const keyStateRef = useRef({ markFrame, range });
    keyStateRef.current = { markFrame, range };
    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
        const state = player.getState();
        if (state.status !== 'ready') return;
        const { range: current } = keyStateRef.current;
        const now = state.time;
        let handled = true;
        switch (event.key.toLowerCase()) {
          case 'm': {
            keyStateRef.current.markFrame();
            break;
          }
          case 'i': {
            // Open-ended until O: a provisional end would loop playback short
            // of the moment the reviewer is waiting for.
            const end = current && current.end > now ? current.end : state.duration;
            setRange({ end, start: now });
            showFlash(t('acceptance.video.inPoint', { time: formatVideoTime(now) }));
            break;
          }
          case 'o': {
            const start = current?.start ?? Math.max(0, now - 1);
            if (now > start) {
              setRange({ end: now, start });
              showFlash(t('acceptance.video.outPoint', { time: formatVideoTime(now) }));
            }
            break;
          }
          case 'escape': {
            if (!current) return;
            setRange(null);
            break;
          }
          default: {
            handled = playbackKey(event, player);
          }
        }
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [player, t]);

    /** Press pauses on the frame on screen; a drag circles a region on it; a click plays. */
    const onStageDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const box = element.getBoundingClientRect();
      const origin = {
        x: (event.clientX - box.left) / box.width,
        y: (event.clientY - box.top) / box.height,
      };
      const wasPlaying = !player.getState().paused;
      // The frame on screen at the press is the one being circled.
      const start = player.getState().time;
      player.pause();
      element.setPointerCapture(event.pointerId);
      let current: Rect | null = null;
      const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
      const move = (next: PointerEvent) => {
        const x = clamp((next.clientX - box.left) / box.width);
        const y = clamp((next.clientY - box.top) / box.height);
        current = {
          height: Math.abs(y - origin.y),
          width: Math.abs(x - origin.x),
          x: Math.min(x, origin.x),
          y: Math.min(y, origin.y),
        };
        setDraft(current);
      };
      const up = () => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', up);
        setDraft(null);
        const rect = current as Rect | null;
        if (rect && rect.width > 0.02 && rect.height > 0.02) {
          onAddNote({ rect, time: { start } });
        } else if (!wasPlaying) {
          player.toggle();
        }
      };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', up);
    };

    const dispute = (marker: ClaimMarker) => {
      const { claim } = marker;
      const disputed = notes.some((note) => disputesClaim(note.disputes, claim));
      return (
        <button
          className={styles.dispute}
          disabled={disputed}
          type={'button'}
          onClick={() => {
            player.pause();
            player.seek(claim.t);
            onAddNote({
              disputes: { kind: claim.kind, note: claim.note, t: claim.t },
              time: { start: claim.t },
            });
          }}
        >
          {disputed ? t('acceptance.video.disputed') : t('acceptance.video.dispute')}
        </button>
      );
    };

    return (
      <Video.Root
        defaultPlaybackRate={defaultRate}
        markers={markers}
        player={player}
        preload={'auto'}
        sections={sections}
        src={src}
        style={{
          background: 'transparent',
          borderRadius: 0,
          color: 'inherit',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 10,
          lineHeight: 'inherit',
          minHeight: 0,
          minWidth: 0,
          overflow: 'visible',
        }}
        onRateChange={storeRate}
        onMarkerClick={(marker) => {
          const key = noteKeyOf(marker);
          const entry =
            key === undefined ? undefined : notes.find((note) => String(note.key) === key);
          if (entry) focusNote(entry);
        }}
        onRetry={async () => {
          const fresh = await onRefreshSource?.();
          if (fresh && fresh !== src) setSrc(fresh);
        }}
      >
        <div className={local.fit}>
          <Video.Frame
            style={{
              borderRadius: cssVar.borderRadiusLG,
              height: '100%',
              maxWidth: '100%',
              width: 'auto',
            }}
          >
            {ready && (
              <div className={cx(styles.overlay, styles.drawable)} onPointerDown={onStageDown}>
                <FrameRegions regions={regions} />
                {draft && <DraftRegion rect={draft} />}
                <Hint drafting={Boolean(draft)} flash={flash} />
              </div>
            )}
            {!draft && (
              <Video.Caption
                action={(marker) => ('claim' in marker ? dispute(marker as ClaimMarker) : null)}
              />
            )}
            <Video.LoadError />
          </Video.Frame>
        </div>
        <Video.Controls frameStep style={{ borderRadius: cssVar.borderRadiusLG }}>
          <Video.Timeline>
            <RangeLane notes={timedNotes} range={range} onRange={setRange} onSeek={player.seek} />
          </Video.Timeline>
        </Video.Controls>
        <ReviewTools
          loop={loop}
          range={range}
          ready={ready}
          onClearRange={() => setRange(null)}
          onCommentRange={commentRange}
          onMarkFrame={markFrame}
          onToggleLoop={() => setLoop((value) => !value)}
        />
      </Video.Root>
    );
  },
);

VideoReviewStage.displayName = 'AcceptanceVideoReviewStage';
