'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation, VerifyEvidenceChapter } from '@lobechat/types';
import { createStaticStyles, Flexbox, useVideoPlayer, useVideoState, Video } from '@lobehub/ui';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toClaimMarkers, toNoteMarkers, toSections } from './chapters';
import { readStoredRate, storeRate } from './playbackRate';
import { FrameRegions } from './VideoChrome';
import { VideoClaimList } from './VideoClaimList';

/** Matches the plain `<video>` this replaces, so rows keep their rhythm. */
const MAX_HEIGHT = 360;
/** Leave room for the controls even when the recording is portrait. */
const MIN_PLAYER_WIDTH = 480;

const styles = createStaticStyles(({ css }) => ({
  player: css`
    &:fullscreen {
      display: flex;
      flex-direction: column;
      border-radius: 0;
    }

    &:fullscreen > [data-video-controls] {
      flex: none;
    }
  `,
  stage: css`
    display: flex;
    justify-content: center;

    :fullscreen > & {
      container-type: size;
      flex: 1;
      align-items: center;

      min-width: 0;
      min-height: 0;
    }
  `,
  frame: css`
    max-width: var(--acceptance-video-frame-width);

    :fullscreen & {
      flex: none;
      width: min(100cqw, calc(100cqh * var(--acceptance-video-aspect)));
      max-width: none;
      height: min(100cqh, calc(100cqw / var(--acceptance-video-aspect)));
    }
  `,
}));

interface VideoEvidencePlayerProps {
  /** The evidence description — laid out under the player, at the content area's width. */
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
 * steps as sections and its claims captioned over the frame, and earlier notes
 * pinned where they were made.
 */
export const VideoEvidencePlayer = memo<VideoEvidencePlayerProps>(
  ({ caption, chapters = [], notes = [], onRefreshSource, src }) => {
    const { t } = useTranslation('verify');
    const player = useVideoPlayer();
    const size = useVideoState(player, (state) => state.size);
    const aspect = size?.height ? size.width / size.height : 16 / 9;
    const frameWidth = Math.round(MAX_HEIGHT * aspect);
    const [defaultRate] = useState(readStoredRate);

    const timed = useMemo(
      () => notes.flatMap((note) => (note.time ? [{ ...note, time: note.time }] : [])),
      [notes],
    );
    const sections = useMemo(() => toSections(chapters), [chapters]);
    const markers = useMemo(
      () => [
        ...toClaimMarkers(chapters, (kind) => t(`acceptance.video.claim.${kind}`)),
        ...toNoteMarkers(
          timed.map((note, index) => ({
            comment: note.comment,
            key: index,
            start: note.time.start,
          })),
        ),
      ],
      [chapters, t, timed],
    );
    const regions = useMemo(
      () =>
        timed
          .filter((note) => !isFullFrameRect(note.rect))
          .map((note, index) => ({
            comment: note.comment,
            key: index,
            rect: note.rect,
            start: note.time.start,
          })),
      [timed],
    );

    return (
      <Flexbox gap={8} width={'100%'}>
        <Video.Root
          className={styles.player}
          defaultPlaybackRate={defaultRate}
          markers={markers}
          maxHeight={MAX_HEIGHT}
          player={player}
          sections={sections}
          src={src}
          style={
            {
              '--acceptance-video-aspect': aspect,
              '--acceptance-video-frame-width': `${frameWidth}px`,
              'maxWidth': `min(100%, ${Math.max(MIN_PLAYER_WIDTH, frameWidth)}px)`,
            } as CSSProperties
          }
          onRateChange={storeRate}
          onRetry={onRefreshSource}
        >
          {/* The fullscreen frame fits the space left by the controls, not the viewport width. */}
          <div className={styles.stage}>
            <Video.Frame className={styles.frame}>
              <FrameRegions regions={regions} />
              <Video.Caption />
              <Video.CenterPlay />
              <Video.LoadError />
            </Video.Frame>
          </div>
          <Video.Controls frameStep />
        </Video.Root>
        {caption && <div style={{ overflowWrap: 'anywhere' }}>{caption}</div>}
        <VideoClaimList
          chapters={chapters}
          onSeek={(seconds) => {
            player.pause();
            player.seek(seconds);
            player.setCaptions(true);
          }}
        />
      </Flexbox>
    );
  },
);

VideoEvidencePlayer.displayName = 'AcceptanceVideoEvidencePlayer';
