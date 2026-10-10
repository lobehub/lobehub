'use client';

import type { VerifyEvidenceChapter } from '@lobechat/types';
import { Button, Center, cx, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import {
  AlertTriangle,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaimLabel } from './ClaimLabel';
import { styles } from './styles';
import type { VideoClock } from './useVideoClock';
import { claimsOf, formatVideoTime, frameOf, isOnFrame, PLAYBACK_RATES, stepAt } from './videoTime';

type Rect = { height: number; width: number; x: number; y: number };

const percent = (rect: Rect) => ({
  height: `${rect.height * 100}%`,
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
});

/** A region drawn on a frame, shown only while that frame is on screen. */
export interface FrameRegion {
  comment?: string;
  key: number | string;
  rect: Rect;
  start: number;
}

export const FrameRegions = ({
  paused,
  regions,
  time,
}: {
  paused: boolean;
  regions: FrameRegion[];
  time: number;
}) =>
  regions
    .filter((region) => isOnFrame(region.start, time, paused))
    .map((region) => (
      <div className={styles.region} key={region.key} style={percent(region.rect)}>
        {region.comment && <span className={styles.regionLabel}>{region.comment}</span>}
      </div>
    ));

export const DraftRegion = ({ rect }: { rect: Rect }) => (
  <div className={styles.draft} style={percent(rect)} />
);

/**
 * The agent's claim at this moment, captioned over the frame it is about.
 * `action` is where the review stage puts its "I disagree" button.
 */
export const ClaimCaption = ({
  action,
  claims,
}: {
  action?: (claim: VerifyEvidenceChapter) => ReactNode;
  claims: VerifyEvidenceChapter[];
}) => (
  <div className={styles.caption} onPointerDown={(event) => event.stopPropagation()}>
    {claims.map((claim, index) => (
      <div key={`${claim.kind}-${index}`} style={{ marginBlockStart: index > 0 ? 8 : 0 }}>
        <div className={styles.captionTitle}>
          <ClaimLabel kind={claim.kind} />
          {action?.(claim)}
        </div>
        <div>{claim.note}</div>
      </div>
    ))}
  </div>
);

/**
 * A video that failed to load — usually a signed link that expired while the
 * page stayed open. Reload re-signs nothing but retries a transient failure;
 * the download link opens the file directly as the way out.
 */
export const VideoLoadError = ({ onReload, src }: { onReload: () => void; src: string }) => {
  const { t } = useTranslation('verify');

  return (
    <Center className={styles.overlay} gap={10} style={{ color: '#ccc' }}>
      <Icon icon={AlertTriangle} size={22} />
      <span style={{ fontSize: 13 }}>{t('acceptance.video.loadFailed')}</span>
      <Flexbox horizontal gap={8}>
        <Button icon={RefreshCw} size={'small'} onClick={onReload}>
          {t('acceptance.video.reload')}
        </Button>
        <Button href={src} icon={Download} size={'small'} target={'_blank'}>
          {t('acceptance.video.download')}
        </Button>
      </Flexbox>
    </Center>
  );
};

interface VideoControlBarProps {
  captions?: boolean;
  chapters: VerifyEvidenceChapter[];
  clock: VideoClock;
  onFullscreen?: () => void;
  /** Absent where captions are always on (the review stage needs them to dispute). */
  onToggleCaptions?: () => void;
}

/** Play, frame step, the frame readout, captions, speed — below the timeline. */
export const VideoControlBar = ({
  captions,
  chapters,
  clock,
  onFullscreen,
  onToggleCaptions,
}: VideoControlBarProps) => {
  const { t } = useTranslation('verify');
  const { controls, duration, paused, rate, time } = clock;
  const step = stepAt(chapters, time);

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      <button
        aria-label={paused ? t('acceptance.video.play') : t('acceptance.video.pause')}
        className={styles.barButton}
        title={`${paused ? t('acceptance.video.play') : t('acceptance.video.pause')} (Space)`}
        type={'button'}
        onClick={controls.toggle}
      >
        <Icon icon={paused ? Play : Pause} size={16} />
      </button>
      <button
        aria-label={t('acceptance.video.previousFrame')}
        className={styles.barButton}
        title={`${t('acceptance.video.previousFrame')} (,)`}
        type={'button'}
        onClick={() => controls.step(-1)}
      >
        <Icon icon={ChevronLeft} size={16} />
      </button>
      <button
        aria-label={t('acceptance.video.nextFrame')}
        className={styles.barButton}
        title={`${t('acceptance.video.nextFrame')} (.)`}
        type={'button'}
        onClick={() => controls.step(1)}
      >
        <Icon icon={ChevronRight} size={16} />
      </button>
      <span className={styles.time}>
        {formatVideoTime(time)} / {formatVideoTime(duration)}
      </span>
      <span className={styles.frameNo}>
        {t('acceptance.video.frame', { frame: frameOf(time) })}
        {step?.label ? ` · ${step.label}` : ''}
      </span>
      <div style={{ flex: 1 }} />
      {onToggleCaptions && claimsOf(chapters).length > 0 && (
        <button
          aria-pressed={captions}
          className={cx(styles.barButton, captions && styles.barButtonActive)}
          title={captions ? t('acceptance.video.captionsHide') : t('acceptance.video.captionsShow')}
          type={'button'}
          onClick={onToggleCaptions}
        >
          <Icon icon={Captions} size={16} />
        </button>
      )}
      <DropdownMenu
        items={PLAYBACK_RATES.map((value) => ({
          extra: value === rate ? <Icon icon={Check} /> : undefined,
          key: String(value),
          label: `${value}×`,
          onClick: () => controls.setRate(value),
        }))}
      >
        <button
          className={cx(styles.barButton, rate !== 1 && styles.barButtonActive)}
          title={`${t('acceptance.video.speed')} (J / L)`}
          type={'button'}
        >
          {rate}×
        </button>
      </DropdownMenu>
      {onFullscreen && (
        <button
          aria-label={t('acceptance.video.fullscreen')}
          className={styles.barButton}
          title={t('acceptance.video.fullscreen')}
          type={'button'}
          onClick={onFullscreen}
        >
          <Icon icon={Maximize} size={15} />
        </button>
      )}
    </Flexbox>
  );
};

/**
 * Keys shared by both players. Returns true when the key was handled so the
 * caller can stop the page from also scrolling on Space or the arrows.
 */
export const handlePlaybackKey = (event: KeyboardEvent | ReactKeyboardEvent, clock: VideoClock) => {
  // A focused button owns Space and Enter — they must activate it, not play.
  if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter'))
    return false;
  const { controls, rate, time } = clock;
  const nextRate = (direction: 1 | -1) => {
    const index = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
    const next =
      PLAYBACK_RATES[
        Math.min(Math.max((index === -1 ? 1 : index) + direction, 0), PLAYBACK_RATES.length - 1)
      ];
    controls.setRate(next);
  };
  switch (event.key.toLowerCase()) {
    case ' ':
    case 'k': {
      controls.toggle();
      return true;
    }
    case ',': {
      controls.step(-1);
      return true;
    }
    case '.': {
      controls.step(1);
      return true;
    }
    case 'arrowleft': {
      controls.seek(time - (event.shiftKey ? 5 : 1));
      return true;
    }
    case 'arrowright': {
      controls.seek(time + (event.shiftKey ? 5 : 1));
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
