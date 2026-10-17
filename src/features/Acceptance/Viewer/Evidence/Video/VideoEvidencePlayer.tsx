'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import type { AcceptanceReviewAnnotation, VerifyEvidenceChapter } from '@lobechat/types';
import { Flexbox, useVideoPlayer, Video } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toClaimMarkers, toNoteMarkers, toSections } from './chapters';
import { readStoredRate, storeRate } from './playbackRate';
import { FrameRegions } from './VideoChrome';
import { VideoClaimList } from './VideoClaimList';

/** Matches the plain `<video>` this replaces, so rows keep their rhythm. */
const MAX_HEIGHT = 360;

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
          defaultPlaybackRate={defaultRate}
          markers={markers}
          maxHeight={MAX_HEIGHT}
          player={player}
          sections={sections}
          src={src}
          onRateChange={storeRate}
          onRetry={onRefreshSource}
        >
          <Video.Frame>
            <FrameRegions regions={regions} />
            <Video.Caption />
            <Video.CenterPlay />
            <Video.LoadError />
          </Video.Frame>
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
