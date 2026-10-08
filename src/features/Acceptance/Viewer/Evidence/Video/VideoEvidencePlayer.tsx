'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation, VerifyEvidenceChapter } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useRef, useState } from 'react';

import { styles } from './styles';
import { useVideoClock } from './useVideoClock';
import {
  ClaimCaption,
  FrameRegions,
  handlePlaybackKey,
  VideoControlBar,
  VideoLoadError,
} from './VideoChrome';
import { VideoClaimList } from './VideoClaimList';
import { claimsAt } from './videoTime';
import { VideoTimeline } from './VideoTimeline';

/** Matches the plain `<video>` this replaces, so rows keep their rhythm. */
const MAX_HEIGHT = 360;

interface VideoEvidencePlayerProps {
  /** The evidence description — laid out under the player, at the player's width. */
  caption?: ReactNode;
  chapters?: VerifyEvidenceChapter[];
  /** Reviewer notes already made on this video, pinned to the timeline. */
  notes?: AcceptanceReviewAnnotation[];
  /** Re-sign the file link before retrying — an expired link never loads. */
  onRefreshSource?: () => Promise<unknown>;
  src: string;
}

/**
 * A video evidence as a reviewer needs it: speed, frame stepping, the agent's
 * steps and claims on the timeline and captioned over the frame, and earlier
 * notes pinned where they were made. Keys work once the player has focus, so
 * Space never hijacks the page scroll.
 */
export const VideoEvidencePlayer = memo<VideoEvidencePlayerProps>(
  ({ caption, chapters = [], notes = [], onRefreshSource, src }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const clock = useVideoClock(videoRef, { src });
    const { controls, duration, paused, size, status, time } = clock;
    const [captions, setCaptions] = useState(true);

    const timed = notes.flatMap((note) => (note.time ? [{ ...note, time: note.time }] : []));
    const claims = captions ? claimsAt(chapters, time) : [];
    const aspect = size ? size.width / size.height : 16 / 9;

    return (
      <Flexbox gap={8} style={{ maxWidth: `min(100%, ${Math.round(MAX_HEIGHT * aspect)}px)` }}>
        <div
          className={styles.player}
          ref={rootRef}
          tabIndex={0}
          onKeyDown={(event) => {
            if (status === 'ready' && handlePlaybackKey(event, clock)) event.preventDefault();
          }}
        >
          <div className={styles.frame} style={{ aspectRatio: `${aspect}` }}>
            <video playsInline preload={'metadata'} ref={videoRef} src={src} />
            {status === 'ready' && (
              <div
                className={styles.overlay}
                onClick={controls.toggle}
                onDoubleClick={() => void rootRef.current?.requestFullscreen?.()}
              >
                <FrameRegions
                  paused={paused}
                  time={time}
                  regions={timed
                    .filter((note) => !isFullFrameRect(note.rect))
                    .map((note, index) => ({
                      comment: note.comment,
                      key: index,
                      rect: note.rect,
                      start: note.time.start,
                    }))}
                />
                {paused && time < 0.05 && (
                  <div className={styles.centerPlay}>
                    <Icon icon={Play} size={24} />
                  </div>
                )}
                {claims.length > 0 && <ClaimCaption claims={claims} />}
              </div>
            )}
            {status === 'error' && (
              <VideoLoadError
                src={src}
                onReload={async () => {
                  // A new link re-renders with a new src and loads itself;
                  // the explicit load covers a transient failure on the same one.
                  await onRefreshSource?.();
                  controls.reload();
                }}
              />
            )}
          </div>
          <div
            className={styles.bar}
            style={status === 'ready' ? undefined : { opacity: 0.4, pointerEvents: 'none' }}
          >
            <VideoTimeline
              chapters={chapters}
              duration={duration}
              src={src}
              time={time}
              notes={timed.map((note, index) => ({
                comment: note.comment,
                end: note.time.end,
                key: index,
                start: note.time.start,
              }))}
              onSeek={controls.seek}
              onClaimClick={(item) => {
                controls.pause();
                controls.seek(item.t);
                setCaptions(true);
              }}
              onNoteClick={(note) => {
                controls.pause();
                controls.seek(note.start);
              }}
            />
            <VideoControlBar
              captions={captions}
              chapters={chapters}
              clock={clock}
              onFullscreen={() => void rootRef.current?.requestFullscreen?.()}
              onToggleCaptions={() => setCaptions((value) => !value)}
            />
          </div>
        </div>
        {caption}
        <VideoClaimList
          chapters={chapters}
          onSeek={(seconds) => {
            controls.pause();
            controls.seek(seconds);
            setCaptions(true);
          }}
        />
      </Flexbox>
    );
  },
);

VideoEvidencePlayer.displayName = 'AcceptanceVideoEvidencePlayer';
