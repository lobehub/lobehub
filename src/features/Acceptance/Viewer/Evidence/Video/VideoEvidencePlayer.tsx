'use client';

import { isFullFrameRect } from '@lobechat/const/verify';
import type {
  AcceptanceCommentTime,
  AcceptanceReviewAnnotation,
  VerifyEvidenceChapter,
} from '@lobechat/types';
import {
  cx,
  Flexbox,
  useVideo,
  useVideoPlayer,
  useVideoState,
  Video,
  type VideoPlayer,
} from '@lobehub/ui';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FloatingCommentAction, { FLOATING_ACTION_HOST } from '../FloatingCommentAction';
import { noteKeyOf, toClaimMarkers, toNoteMarkers, toSections } from './chapters';
import { readStoredRate, storeRate } from './playbackRate';
import { styles } from './styles';
import { useVideoRegionGesture } from './useVideoRegionGesture';
import { DraftRegion, type FrameRegion, FrameRegions } from './VideoChrome';
import { VideoClaimList } from './VideoClaimList';
import { frameOf } from './videoTime';

const MAX_HEIGHT = 360;
const MIN_PLAYER_WIDTH = 480;

export interface VideoEvidencePlayerHandle {
  focus: (time: AcceptanceCommentTime, options?: { reveal?: boolean }) => void;
}

/** A comment, draft, or rejection note pinned to its original video frame. */
export interface VideoMark {
  color?: string;
  comment?: string;
  key: string;
  label?: number | string;
  rect: AcceptanceReviewAnnotation['rect'];
  time: NonNullable<AcceptanceReviewAnnotation['time']>;
}

interface VideoEvidencePlayerProps {
  activeMark?: string;
  /** The description stays at content width even when the frame is portrait. */
  caption?: ReactNode;
  chapters?: VerifyEvidenceChapter[];
  frameMaxHeight?: string;
  handleRef?: RefObject<VideoEvidencePlayerHandle | null>;
  initialTime?: number;
  marks?: VideoMark[];
  onComment?: (time: number) => void;
  onMarkClick?: (key: string) => void;
  onRefreshSource?: () => Promise<unknown>;
  onRegion?: (note: { rect: AcceptanceReviewAnnotation['rect']; time: { start: number } }) => void;
  src: string;
}

/** Only the drawing surface subscribes to playback; typing does not redraw the workspace. */
const CommentSurface = ({
  active,
  player,
  regions,
  onRegion,
}: {
  active?: string;
  onRegion: NonNullable<VideoEvidencePlayerProps['onRegion']>;
  player: VideoPlayer;
  regions: FrameRegion[];
}) => {
  const ready = useVideo((state) => state.status === 'ready');
  const frame = useVideo((state) => frameOf(state.time));
  const paused = useVideo((state) => state.paused);
  const { t } = useTranslation('verify');
  const gesture = useVideoRegionGesture(player, onRegion);
  if (!ready) return null;
  return (
    <div className={cx(styles.overlay, styles.drawable)} onPointerDown={gesture.onPointerDown}>
      <FrameRegions active={active} regions={regions} />
      {gesture.draft ? (
        <DraftRegion rect={gesture.draft} />
      ) : (
        <div className={styles.hint}>
          {t(
            paused
              ? 'acceptance.comments.video.hintPaused'
              : 'acceptance.comments.video.hintPlaying',
            { frame },
          )}
        </div>
      )}
    </div>
  );
};

export const VideoEvidencePlayer = memo<VideoEvidencePlayerProps>(
  ({
    activeMark,
    caption,
    chapters = [],
    frameMaxHeight,
    handleRef,
    initialTime = 0,
    marks = [],
    onComment,
    onMarkClick,
    onRefreshSource,
    onRegion,
    src,
  }) => {
    const { t } = useTranslation('verify');
    const player = useVideoPlayer();
    const size = useVideoState(player, (state) => state.size);
    const aspect = size?.height ? size.width / size.height : 16 / 9;
    const frameWidth = Math.round(MAX_HEIGHT * aspect);
    const [defaultRate] = useState(readStoredRate);
    const root = useRef<HTMLDivElement>(null);
    const requestedTime = useRef(initialTime);
    // Seek only once the shared player has metadata; a deep link may arrive before it does.
    useEffect(() => {
      let sought = false;
      const seek = () => {
        if (sought || player.getState().status !== 'ready') return;
        sought = true;
        player.pause();
        player.seek(requestedTime.current);
      };
      seek();
      return player.subscribe(seek);
    }, [player, src]);
    useImperativeHandle(
      handleRef,
      () => ({
        focus: (target, { reveal = true } = {}) => {
          requestedTime.current = target.start;
          player.pause();
          player.seek(target.start);
          if (reveal) root.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        },
      }),
      [player],
    );

    const sections = useMemo(() => toSections(chapters), [chapters]);
    const markers = useMemo(
      () => [
        ...toClaimMarkers(chapters, (kind) => t(`acceptance.video.claim.${kind}`)),
        ...toNoteMarkers(
          marks.map((mark) => ({
            color: mark.color,
            comment: mark.comment,
            key: mark.key,
            start: mark.time.start,
          })),
        ),
      ],
      [chapters, marks, t],
    );
    const regions = marks
      .filter((mark) => !isFullFrameRect(mark.rect))
      .map((mark) => ({
        color: mark.color,
        comment: mark.comment,
        key: mark.key,
        label: mark.label,
        rect: mark.rect,
        start: mark.time.start,
      }));

    return (
      <Flexbox gap={8} ref={root} width={'100%'}>
        <div {...{ [FLOATING_ACTION_HOST]: '' }} style={{ position: 'relative', width: '100%' }}>
          <Video.Root
            className={cx(styles.player, styles.compactControls)}
            defaultPlaybackRate={defaultRate}
            markers={markers}
            maxHeight={frameMaxHeight ? undefined : MAX_HEIGHT}
            player={player}
            sections={sections}
            src={src}
            style={
              {
                '--acceptance-video-aspect': aspect,
                '--acceptance-video-frame-width': frameMaxHeight
                  ? `calc(${frameMaxHeight} * ${aspect})`
                  : `${frameWidth}px`,
                'width': frameMaxHeight ? '100%' : undefined,
                'maxWidth': frameMaxHeight
                  ? `max(${MIN_PLAYER_WIDTH}px, calc(${frameMaxHeight} * ${aspect}))`
                  : `min(100%, ${Math.max(MIN_PLAYER_WIDTH, frameWidth)}px)`,
              } as CSSProperties
            }
            onRateChange={storeRate}
            onRetry={onRefreshSource}
            onMarkerClick={(marker) => {
              const key = noteKeyOf(marker);
              if (key !== undefined) onMarkClick?.(key);
            }}
          >
            <div data-acceptance-video-stage className={styles.stage}>
              <Video.Frame className={styles.frame}>
                {onRegion ? (
                  <CommentSurface
                    active={activeMark}
                    player={player}
                    regions={regions}
                    onRegion={onRegion}
                  />
                ) : (
                  <FrameRegions active={activeMark} regions={regions} />
                )}
                <Video.Caption />
                {!onRegion && <Video.CenterPlay />}
                <Video.LoadError />
              </Video.Frame>
            </div>
            <Video.Controls frameStep />
          </Video.Root>
          {onComment && (
            <FloatingCommentAction
              title={t('acceptance.comments.commentMedia')}
              onClick={() => {
                player.pause();
                onComment(player.getState().time);
              }}
            />
          )}
        </div>
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
