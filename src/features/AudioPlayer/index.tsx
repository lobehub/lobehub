'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { DownloadIcon, PauseIcon, PlayIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VoiceMessageUploadState } from '@/store/chat/slices/voiceMessage/initialState';

import { useAudioElementSource } from './useAudioElementSource';
import { useWaveform } from './useWaveform';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionGroup: css`
    display: flex;
    flex: none;
    gap: 2px;
  `,
  bar: css`
    flex: 1;

    min-width: 2px;
    border-radius: 4px;

    background: ${cssVar.colorTextQuaternary};

    transition: background 120ms ease;
  `,
  barPlayed: css`
    background: ${cssVar.colorText};
  `,
  button: css`
    cursor: pointer;

    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border: none;
    border-radius: 8px;

    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorText};

    transition: opacity 120ms ease;

    &:hover {
      opacity: 0.8;
    }
  `,
  container: css`
    display: flex;
    gap: 12px;
    align-items: center;

    width: 360px;
    max-width: 100%;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorFillQuaternary};
  `,
  download: css`
    cursor: pointer;

    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition: all 120ms ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  miniButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition:
      color 120ms ease,
      background 120ms ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 1px;
    }
  `,
  progress: css`
    position: absolute;
    inset-block-end: 0;
    inset-inline: 0;

    overflow: hidden;

    height: 2px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressValue: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorPrimary};
    transition: width 160ms ease;
  `,
  status: css`
    pointer-events: none;

    position: absolute;
    inset: 0;

    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    padding-inline: 4px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  time: css`
    flex: none;

    min-width: 36px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: end;
  `,
  waveform: css`
    cursor: pointer;

    overflow: hidden;
    display: flex;
    flex: 1;
    gap: 2px;
    align-items: center;

    /* The bars' intrinsic minimum (56 × min-width + gaps ≈ 222px) must never
       set the row's minimum — without this, adding any sibling (the download
       button) pushes the tail controls out of the rounded box. */
    min-width: 0;
    height: 32px;
    padding: 0;
    border: 0;

    background: transparent;

    &:focus-visible {
      border-radius: 4px;
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  waveformPending: css`
    opacity: 0.18;
  `,
  waveformWrap: css`
    position: relative;

    display: flex;
    flex: 1;

    min-width: 0;
    height: 32px;
  `,
}));

export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

interface AudioPlayerProps {
  alt?: string;
  /** Download filename; also switches the download affordance on. */
  downloadFileName?: string;
  durationMs?: number;
  /**
   * Fill the host's width instead of the chat bubble's fixed 360px — evidence
   * surfaces render the player as a block, not an inline attachment.
   */
  fullWidth?: boolean;
  onCancelUpload?: () => void;
  onRetryUpload?: () => void;
  uploadState?: VoiceMessageUploadState;
  url: string;
}

const AudioPlayer = memo<AudioPlayerProps>(
  ({
    url,
    alt,
    downloadFileName,
    durationMs,
    fullWidth,
    onCancelUpload,
    onRetryUpload,
    uploadState,
  }) => {
    const { t } = useTranslation('chat');
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(() => (durationMs ? durationMs / 1000 : 0));
    // Only fetch/decode the waveform once the user actually engages with the clip, so a conversation
    // full of audio attachments doesn't download every file just to draw decorative bars.
    const [waveformEnabled, setWaveformEnabled] = useState(false);

    useAudioElementSource(audioRef, url);

    const peaks = useWaveform(url, waveformEnabled);
    const progress = duration > 0 ? currentTime / duration : 0;
    const uploadProgress = Math.min(100, Math.max(0, Math.round(uploadState?.progress ?? 0)));
    const isFailed = uploadState?.status === 'failed';
    const isPending = uploadState?.status === 'uploading' || uploadState?.status === 'sending';
    const statusText =
      uploadState?.status === 'uploading'
        ? t('voiceMessage.status.uploading', { progress: uploadProgress })
        : uploadState?.status === 'sending'
          ? t('voiceMessage.status.sending')
          : uploadState?.error === 'unsupported'
            ? t('voiceMessage.status.unsupported')
            : uploadState?.error === 'send'
              ? t('voiceMessage.status.sendFailed')
              : uploadState?.error === 'upload'
                ? t('voiceMessage.status.uploadFailed')
                : undefined;

    useEffect(() => {
      setCurrentTime(0);
      setDuration(durationMs ? durationMs / 1000 : 0);
      setIsPlaying(false);
      setWaveformEnabled(false);
    }, [durationMs, url]);

    const togglePlay = useCallback(() => {
      const audio = audioRef.current;
      if (!audio) return;
      setWaveformEnabled(true);
      if (audio.paused) void audio.play();
      else audio.pause();
    }, []);

    const handleSeek = useCallback(
      (e: MouseEvent<HTMLButtonElement>) => {
        const audio = audioRef.current;
        if (!audio || !duration) return;
        setWaveformEnabled(true);
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        audio.currentTime = ratio * duration;
        setCurrentTime(ratio * duration);
      },
      [duration],
    );

    // Cross-origin sources (a signed S3 url) ignore the anchor `download`
    // attribute, so pull the bytes and hand out a same-origin object url — the
    // one route that saves with the intended filename instead of navigating.
    const handleDownload = useCallback(async () => {
      if (!downloadFileName) return;
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = downloadFileName;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      } catch {
        window.open(url, '_blank', 'noopener');
      }
    }, [url, downloadFileName]);

    return (
      <div className={styles.container} style={fullWidth ? { width: '100%' } : undefined}>
        <audio
          preload={'metadata'}
          ref={audioRef}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onEnded={() => setIsPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        />
        <button
          aria-label={isPlaying ? t('audioPlayer.pause') : t('audioPlayer.play')}
          aria-pressed={isPlaying}
          className={styles.button}
          title={alt}
          type={'button'}
          onClick={togglePlay}
        >
          <Icon icon={isPlaying ? PauseIcon : PlayIcon} size={16} />
        </button>
        <div className={styles.waveformWrap}>
          <button
            aria-label={t('audioPlayer.seek')}
            className={`${styles.waveform} ${uploadState ? styles.waveformPending : ''}`}
            type="button"
            onClick={handleSeek}
          >
            {peaks.map((peak, i) => {
              const played = peaks.length > 0 && i / peaks.length <= progress;
              return (
                <div
                  className={played ? `${styles.bar} ${styles.barPlayed}` : styles.bar}
                  key={i}
                  style={{ height: `${Math.round(peak * 100)}%` }}
                />
              );
            })}
          </button>
          {statusText && (
            <span aria-live="polite" className={styles.status} role="status" title={statusText}>
              {statusText}
            </span>
          )}
          {uploadState?.status === 'uploading' && (
            <div className={styles.progress}>
              <div className={styles.progressValue} style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>
        <span className={styles.time}>{formatTime(currentTime || duration)}</span>
        {downloadFileName && (
          <button
            aria-label={t('audioPlayer.download')}
            className={styles.download}
            title={t('audioPlayer.download')}
            type={'button'}
            onClick={() => void handleDownload()}
          >
            <Icon icon={DownloadIcon} size={15} />
          </button>
        )}
        {uploadState && (
          <div className={styles.actionGroup}>
            {isFailed && (
              <button
                aria-label={t('voiceMessage.retry')}
                className={styles.miniButton}
                title={t('voiceMessage.retry')}
                type="button"
                onClick={() => onRetryUpload?.()}
              >
                <Icon icon={RotateCcwIcon} size={14} />
              </button>
            )}
            {(isPending || isFailed) && (
              <button
                aria-label={t(isFailed ? 'voiceMessage.delete' : 'voiceMessage.cancelUpload')}
                className={styles.miniButton}
                title={t(isFailed ? 'voiceMessage.delete' : 'voiceMessage.cancelUpload')}
                type="button"
                onClick={() => onCancelUpload?.()}
              >
                <Icon icon={XIcon} size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
);

AudioPlayer.displayName = 'AudioPlayer';

export default AudioPlayer;
