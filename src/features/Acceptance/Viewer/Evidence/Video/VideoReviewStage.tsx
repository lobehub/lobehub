'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation, VerifyEvidenceChapter } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  createStaticStyles,
  cssVar,
  cx,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { Flag, MessageSquareText, Repeat, X } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DraftAnnotationEntry } from '../../Review/rejectDraft';
import { styles } from './styles';
import type { VideoLoop } from './useVideoClock';
import { useVideoClock } from './useVideoClock';
import {
  ClaimCaption,
  DraftRegion,
  FrameRegions,
  handlePlaybackKey,
  VideoControlBar,
  VideoLoadError,
} from './VideoChrome';
import { claimsAt, disputesClaim, formatVideoTime, frameOf } from './videoTime';
import { VideoTimeline } from './VideoTimeline';

type Rect = AcceptanceReviewAnnotation['rect'];

const local = createStaticStyles(({ css }) => ({
  column: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;

    min-width: 0;
    min-height: 0;
  `,
  /** The frame shrinks to the room left by the timeline and the tools. */
  fit: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    min-height: 0;
  `,
  tools: css`
    flex: none;

    min-height: 40px;
    padding-block: 6px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    font-size: 12px;

    background: ${cssVar.colorFillQuaternary};
  `,
  kbd: css`
    display: inline-block;

    min-width: 16px;
    margin-inline: 1px;
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
}));

export interface VideoReviewStageHandle {
  /** Pause on a note's frame (and select its span) — the notes panel's "go there". */
  focusNote: (note: DraftAnnotationEntry) => void;
}

interface VideoReviewStageProps {
  activeNoteKey?: number;
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

/**
 * Where a video is rejected. Pressing on the picture pauses on the frame being
 * shown and draws a region on it; M marks the frame without a region; the lane
 * under the timeline (or I / O) selects a span that loops while it is judged;
 * and an agent claim captioned on screen can be disputed in one click.
 */
export const VideoReviewStage = memo<VideoReviewStageProps>(
  ({
    activeNoteKey,
    chapters,
    handleRef,
    notes,
    onAddNote,
    onRefreshSource,
    onSelectNote,
    src: initialSrc,
  }) => {
    const { t } = useTranslation('verify');
    const videoRef = useRef<HTMLVideoElement>(null);
    // The modal holds the link it opened with; a re-signed one replaces it here.
    const [src, setSrc] = useState(initialSrc);
    const [range, setRange] = useState<VideoLoop | null>(null);
    const [loop, setLoop] = useState(true);
    const clock = useVideoClock(videoRef, { loop: loop ? range : null, src });
    const { controls, duration, paused, size, status, time } = clock;
    const [draft, setDraft] = useState<Rect | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const showFlash = (text: string) => {
      setFlash(text);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 1400);
    };
    useEffect(() => () => clearTimeout(flashTimer.current), []);

    const focusNote = (note: DraftAnnotationEntry) => {
      if (!note.time) return;
      controls.pause();
      controls.seek(note.time.start);
      setRange(note.time.end === undefined ? null : { end: note.time.end, start: note.time.start });
      onSelectNote(note.key);
    };
    useImperativeHandle(handleRef, () => ({ focusNote }));

    const markFrame = () => {
      const start = controls.frameTime();
      controls.pause();
      onAddNote({ time: { start } });
    };

    const commentRange = () => {
      if (!range) return;
      onAddNote({ time: { end: range.end, start: range.start } });
      setRange(null);
    };

    // The modal is the review: keys act whenever the reviewer is not typing.
    const keyState = { clock, markFrame, range };
    const keyStateRef = useRef(keyState);
    keyStateRef.current = keyState;
    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
        const state = keyStateRef.current;
        if (state.clock.status !== 'ready') return;
        const now = state.clock.time;
        let handled = true;
        switch (event.key.toLowerCase()) {
          case 'm': {
            state.markFrame();
            break;
          }
          case 'i': {
            // Open-ended until O: a provisional end would loop playback short
            // of the moment the reviewer is waiting for.
            const end =
              state.range && state.range.end > now ? state.range.end : state.clock.duration;
            setRange({ end, start: now });
            showFlash(t('acceptance.video.inPoint', { time: formatVideoTime(now) }));
            break;
          }
          case 'o': {
            const start = state.range?.start ?? Math.max(0, now - 1);
            if (now > start) {
              setRange({ end: now, start });
              showFlash(t('acceptance.video.outPoint', { time: formatVideoTime(now) }));
            }
            break;
          }
          case 'escape': {
            if (!state.range) return;
            setRange(null);
            break;
          }
          default: {
            handled = handlePlaybackKey(event, state.clock);
          }
        }
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [t]);

    /** Press pauses on the frame on screen; a drag circles a region on it; a click plays. */
    const onStageDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const box = element.getBoundingClientRect();
      const origin = {
        x: (event.clientX - box.left) / box.width,
        y: (event.clientY - box.top) / box.height,
      };
      const wasPlaying = !paused;
      // The frame on screen at the press is the one being circled.
      const start = controls.frameTime();
      controls.pause();
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
          controls.toggle();
        }
      };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', up);
    };

    const claims = claimsAt(chapters, time);
    const timed = notes.filter((note) => note.time);
    const aspect = size ? size.width / size.height : 16 / 9;

    let hint: string | null = flash;
    if (!hint && !draft)
      hint = paused
        ? t('acceptance.video.hintPaused', { frame: frameOf(time) })
        : t('acceptance.video.hintPlaying');

    return (
      <div className={local.column}>
        <div className={local.fit}>
          <div
            className={styles.player}
            style={{
              aspectRatio: `${aspect}`,
              maxHeight: '100%',
              width: 'auto',
              height: '100%',
              maxWidth: '100%',
            }}
          >
            <div className={styles.frame} style={{ height: '100%' }}>
              <video playsInline preload={'auto'} ref={videoRef} src={src} />
              {status === 'ready' && (
                <div className={cx(styles.overlay, styles.drawable)} onPointerDown={onStageDown}>
                  <FrameRegions
                    paused={paused}
                    time={time}
                    regions={timed
                      .filter((note) => !isFullFrameRect(note.rect))
                      .map((note) => ({
                        comment: note.comment,
                        key: note.key,
                        rect: note.rect,
                        start: note.time!.start,
                      }))}
                  />
                  {draft && <DraftRegion rect={draft} />}
                  {hint && <div className={styles.hint}>{hint}</div>}
                  {claims.length > 0 && !draft && (
                    <ClaimCaption
                      claims={claims}
                      action={(claim) => {
                        const disputed = notes.some((note) => disputesClaim(note.disputes, claim));
                        return (
                          <button
                            className={styles.dispute}
                            disabled={disputed}
                            type={'button'}
                            onClick={() => {
                              controls.pause();
                              controls.seek(claim.t);
                              onAddNote({
                                disputes: { kind: claim.kind, note: claim.note, t: claim.t },
                                time: { start: claim.t },
                              });
                            }}
                          >
                            {disputed
                              ? t('acceptance.video.disputed')
                              : t('acceptance.video.dispute')}
                          </button>
                        );
                      }}
                    />
                  )}
                </div>
              )}
              {status === 'error' && (
                <VideoLoadError
                  src={src}
                  onReload={async () => {
                    const fresh = await onRefreshSource?.();
                    if (fresh && fresh !== src) setSrc(fresh);
                    else controls.reload();
                  }}
                />
              )}
            </div>
          </div>
        </div>
        {/* Not clipped like the frame: the hover preview rises above the bar. */}
        <div className={styles.player} style={{ flex: 'none', overflow: 'visible' }}>
          <div className={styles.bar} style={{ borderRadius: 'inherit' }}>
            <VideoTimeline
              activeNoteKey={activeNoteKey}
              chapters={chapters}
              duration={duration}
              range={range}
              src={src}
              time={time}
              notes={timed.map((note) => ({
                comment: note.comment,
                end: note.time!.end,
                key: note.key,
                start: note.time!.start,
              }))}
              onRange={setRange}
              onSeek={controls.seek}
              onClaimClick={(item) => {
                controls.pause();
                controls.seek(item.t);
              }}
              onNoteClick={(note) => {
                const entry = notes.find((item) => item.key === note.key);
                if (entry) focusNote(entry);
              }}
            />
            <VideoControlBar chapters={chapters} clock={clock} />
          </div>
        </div>
        <Flexbox horizontal align={'center'} className={local.tools} gap={8}>
          {range ? (
            <>
              <Icon icon={Repeat} size={14} />
              <span className={local.mono}>
                {formatVideoTime(range.start)} – {formatVideoTime(range.end)}
              </span>
              <Text fontSize={12} type={'secondary'}>
                {t('acceptance.video.rangeSeconds', {
                  seconds: (range.end - range.start).toFixed(1),
                })}
              </Text>
              <div style={{ flex: 1 }} />
              <Button
                size={'small'}
                type={loop ? 'primary' : 'default'}
                onClick={() => setLoop((value) => !value)}
              >
                {t('acceptance.video.loop')}
              </Button>
              <Button icon={MessageSquareText} size={'small'} onClick={commentRange}>
                {t('acceptance.video.commentRange')}
              </Button>
              <ActionIcon
                icon={X}
                size={'small'}
                title={t('acceptance.video.clearRange')}
                onClick={() => setRange(null)}
              />
            </>
          ) : (
            <>
              <Text fontSize={12} type={'secondary'}>
                <span className={local.kbd}>Space</span> {t('acceptance.video.play')} ·{' '}
                <span className={local.kbd}>,</span>
                <span className={local.kbd}>.</span> {t('acceptance.video.keysFrame')} ·{' '}
                <span className={local.kbd}>J</span>
                <span className={local.kbd}>L</span> {t('acceptance.video.speed')} ·{' '}
                <span className={local.kbd}>M</span> {t('acceptance.video.markFrame')} ·{' '}
                <span className={local.kbd}>I</span>
                <span className={local.kbd}>O</span> {t('acceptance.video.keysRange')}
              </Text>
              <div style={{ flex: 1 }} />
              <Button disabled={status !== 'ready'} icon={Flag} size={'small'} onClick={markFrame}>
                {t('acceptance.video.markFrame')}
              </Button>
            </>
          )}
        </Flexbox>
      </div>
    );
  },
);

VideoReviewStage.displayName = 'AcceptanceVideoReviewStage';
