'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation, VerifyEvidenceChapter } from '@lobechat/types';
import { useVideoPlayer, useVideoState, Video } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import type { DraftAnnotationEntry } from '../../Review/rejectDraft';
import { toSections } from './chapters';
import { ChapterScrubber } from './ChapterScrubber';
import { readStoredRate, storeRate } from './playbackRate';
import { AddNoteRow, ReviewControls } from './ReviewControls';
import { buildVideoStory, spanFromFrame, storyNoteId } from './story';
import { styles } from './styles';
import { useReviewKeys, type VideoLoop } from './useReviewKeys';
import { useVideoRegionGesture } from './useVideoRegionGesture';
import { DraftRegion, FrameRegions } from './VideoChrome';
import { VideoLoadFailed } from './VideoLoadFailed';
import { storyEntryDomId, toReviewStoryNotes, VideoReviewStory } from './VideoReviewStory';
import { VideoStoryCaption } from './VideoStoryCaption';

type Rect = AcceptanceReviewAnnotation['rect'];
type NoteTime = NonNullable<AcceptanceReviewAnnotation['time']>;

const local = stylex.create({
  layout: {
    display: 'grid',
    flex: '1',
    gridTemplateRows: 'minmax(0, 1fr)',
    gridTemplateColumns: 'minmax(0, 1fr) 360px',
    gap: '24px',
    minWidth: 0,
    minHeight: 0,
  },
  player: {
    overflow: 'visible',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    padding: { 'default': 0, ':fullscreen': '24px' },
    borderRadius: 0,
    lineHeight: 'inherit',
    color: 'inherit',
    backgroundColor: { 'default': 'transparent', ':fullscreen': cssVar.colorBgContainer },
    backgroundImage: 'none',
  },
  fit: {
    display: 'flex',
    flex: '1',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '0',
  },
  story: {
    overflowY: 'auto',
    minHeight: 0,
    paddingInline: '8px',
  },
});

interface VideoReviewStageProps {
  activeNoteKey?: number;
  chapters: VerifyEvidenceChapter[];
  notes: DraftAnnotationEntry[];
  onAddNote: (note: {
    disputes?: AcceptanceReviewAnnotation['disputes'];
    rect?: Rect;
    time: NoteTime;
  }) => number;
  onChangeNote: (key: number, comment: string) => void;
  /** Re-sign the file link; resolves to the fresh URL, if the evidence still exists. */
  onRefreshSource?: () => Promise<string | undefined>;
  onRemoveNote: (key: number) => void;
  onSelectNote: (key: number) => void;
  src: string;
}

export const VideoReviewStage = memo<VideoReviewStageProps>(
  ({
    activeNoteKey,
    chapters,
    notes,
    onAddNote,
    onChangeNote,
    onRefreshSource,
    onRemoveNote,
    onSelectNote,
    src: initialSrc,
  }) => {
    const player = useVideoPlayer();
    // The modal holds the link it opened with; a re-signed one replaces it here.
    const [src, setSrc] = useState(initialSrc);
    const [range, setRange] = useState<VideoLoop | null>(null);
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

    useEffect(() => {
      if (!range) return;
      return player.subscribe((state) => {
        if (!state.paused && state.time >= range.end) player.seek(range.start);
      });
    }, [player, range]);

    const sections = useMemo(() => toSections(chapters), [chapters]);
    const story = useMemo(
      () => buildVideoStory(chapters, toReviewStoryNotes(notes)),
      [chapters, notes],
    );
    const regions = story.flatMap((entry) =>
      entry.type === 'note' && !isFullFrameRect(entry.note.source.rect)
        ? [
            {
              key: String(entry.note.key),
              label: entry.index,
              rect: entry.note.source.rect,
              start: entry.time,
            },
          ]
        : [],
    );

    const seek = (seconds: number) => {
      player.pause();
      player.seek(seconds);
    };

    const focusNote = (note: DraftAnnotationEntry) => {
      if (!note.time) return;
      seek(note.time.start);
      setRange(note.time.end === undefined ? null : { end: note.time.end, start: note.time.start });
      onSelectNote(note.key);
    };

    const revealEntry = (id: string) =>
      requestAnimationFrame(() =>
        document.getElementById(storyEntryDomId(id))?.scrollIntoView({ block: 'nearest' }),
      );

    const markFrame = () => {
      const start = player.getState().time;
      player.pause();
      revealEntry(storyNoteId(onAddNote({ time: { start } })));
    };

    const commentRange = () => {
      if (!range) return;
      onAddNote({ time: { end: range.end, start: range.start } });
      setRange(null);
    };

    const retime = (note: DraftAnnotationEntry, time: NoteTime) => {
      onRemoveNote(note.key);
      onChangeNote(onAddNote({ disputes: note.disputes, rect: note.rect, time }), note.comment);
      setRange(time.end === undefined ? null : { end: time.end, start: time.start });
    };

    useReviewKeys(player, {
      onFlash: showFlash,
      onMarkFrame: markFrame,
      onRange: setRange,
      range,
    });

    const gesture = useVideoRegionGesture(player, onAddNote);

    return (
      <div {...stylex.props(local.layout)}>
        <Video.Root
          className={stylex.props(local.player).className}
          defaultPlaybackRate={defaultRate}
          player={player}
          preload={'auto'}
          sections={sections}
          src={src}
          onRateChange={storeRate}
        >
          <div {...stylex.props(local.fit)}>
            <Video.Frame
              style={{
                borderRadius: cssVar.borderRadiusLG,
                height: '100%',
                maxWidth: '100%',
                width: 'auto',
              }}
            >
              {ready && (
                <div
                  {...stylex.props(styles.overlay, styles.drawable)}
                  onPointerDown={gesture.onPointerDown}
                >
                  <FrameRegions
                    active={activeNoteKey === undefined ? undefined : String(activeNoteKey)}
                    regions={regions}
                  />
                  {gesture.draft && <DraftRegion rect={gesture.draft} />}
                  {flash && !gesture.draft && <div {...stylex.props(styles.hint)}>{flash}</div>}
                  {!gesture.draft && <VideoStoryCaption player={player} story={story} />}
                </div>
              )}
              <VideoLoadFailed
                player={player}
                src={src}
                onRetry={async () => {
                  const fresh = await onRefreshSource?.();
                  if (fresh && fresh !== src) setSrc(fresh);
                }}
              />
            </Video.Frame>
          </div>
          <ChapterScrubber
            chapters={chapters}
            player={player}
            range={range}
            story={story}
            onPin={(entry) => {
              if (entry.type === 'note') focusNote(entry.note.source);
              else seek(entry.time);
              revealEntry(entry.id);
            }}
          />
          <ReviewControls captions={story.length > 0} player={player} />
          <AddNoteRow
            player={player}
            range={range}
            onAdd={range ? commentRange : markFrame}
            onClearRange={() => setRange(null)}
          />
        </Video.Root>
        <div {...stylex.props(local.story)}>
          <VideoReviewStory
            activeNoteKey={activeNoteKey}
            player={player}
            story={story}
            onChangeNote={onChangeNote}
            onFocusNote={focusNote}
            onRemoveNote={onRemoveNote}
            onSeek={seek}
            onSingleFrame={(note) => retime(note, { start: note.time!.start })}
            onCoverSpan={(note) => {
              const { duration, time } = player.getState();
              retime(note, spanFromFrame(note.time!.start, time, duration));
            }}
            onDispute={(claim) => {
              seek(claim.t);
              onAddNote({
                disputes: { kind: claim.kind, note: claim.note, t: claim.t },
                time: { start: claim.t },
              });
            }}
          />
        </div>
      </div>
    );
  },
);

VideoReviewStage.displayName = 'AcceptanceVideoReviewStage';
