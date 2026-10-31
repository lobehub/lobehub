'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { DownloadIcon, PauseIcon, PlayIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VoiceMessageUploadState } from '@/store/chat/slices/voiceMessage/initialState';

import { useAudioElementSource } from './useAudioElementSource';
import { useWaveform } from './useWaveform';

const styles = stylex.create({
  actionGroup: { display: 'flex', flex: 'none', gap: '2px' },
  bar: {
    flex: '1',
    minWidth: '2px',
    borderRadius: '4px',
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
    transition: 'background 120ms ease',
  },
  barPlayed: { backgroundColor: cssVar.colorText, backgroundImage: 'none' },
  button: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderStyle: 'none',
    borderRadius: '8px',
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorText,
    backgroundImage: 'none',
    transition: 'opacity 120ms ease',
    opacity: { 'default': null, ':hover': 0.8 },
  },
  container: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    width: '360px',
    maxWidth: '100%',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  download: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderStyle: 'none',
    borderRadius: '6px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'all 120ms ease',
  },
  miniButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    padding: '0',
    borderStyle: 'none',
    borderRadius: '8px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'color 120ms ease, background 120ms ease',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
  progress: {
    position: 'absolute',
    insetBlockEnd: '0',
    insetInline: '0',
    overflow: 'hidden',
    height: '2px',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  progressValue: {
    height: '100%',
    borderRadius: 'inherit',
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
    transition: 'width 160ms ease',
  },
  status: {
    pointerEvents: 'none',
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: '4px',
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  time: {
    flex: 'none',
    minWidth: '36px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
    textAlign: 'end',
  },
  waveform: {
    cursor: 'pointer',
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    gap: '2px',
    alignItems: 'center',
    minWidth: '0',
    height: '32px',
    padding: '0',
    borderStyle: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    borderRadius: { 'default': null, ':focus-visible': '4px' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  waveformPending: { opacity: 0.18 },
  waveformWrap: { position: 'relative', display: 'flex', flex: '1', minWidth: '0', height: '32px' },
});

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
      <div
        className={stylex.props(styles.container).className}
        style={fullWidth ? { width: '100%' } : undefined}
      >
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
          {...stylex.props(styles.button)}
          title={alt}
          type={'button'}
          onClick={togglePlay}
        >
          <Icon icon={isPlaying ? PauseIcon : PlayIcon} size={16} />
        </button>
        <div {...stylex.props(styles.waveformWrap)}>
          <button
            aria-label={t('audioPlayer.seek')}
            {...stylex.props(styles.waveform, uploadState && styles.waveformPending)}
            type="button"
            onClick={handleSeek}
          >
            {peaks.map((peak, i) => {
              const played = peaks.length > 0 && i / peaks.length <= progress;
              return (
                <div
                  key={i}
                  style={{ height: `${Math.round(peak * 100)}%` }}
                  className={
                    played
                      ? stylex.props(styles.bar, styles.barPlayed).className
                      : stylex.props(styles.bar).className
                  }
                />
              );
            })}
          </button>
          {statusText && (
            <span
              aria-live="polite"
              {...stylex.props(styles.status)}
              role="status"
              title={statusText}
            >
              {statusText}
            </span>
          )}
          {uploadState?.status === 'uploading' && (
            <div {...stylex.props(styles.progress)}>
              <div
                className={stylex.props(styles.progressValue).className}
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
        </div>
        <span {...stylex.props(styles.time)}>{formatTime(currentTime || duration)}</span>
        {downloadFileName && (
          <button
            aria-label={t('audioPlayer.download')}
            {...stylex.props(styles.download)}
            title={t('audioPlayer.download')}
            type={'button'}
            onClick={() => void handleDownload()}
          >
            <Icon icon={DownloadIcon} size={15} />
          </button>
        )}
        {uploadState && (
          <div {...stylex.props(styles.actionGroup)}>
            {isFailed && (
              <button
                aria-label={t('voiceMessage.retry')}
                {...stylex.props(styles.miniButton)}
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
                {...stylex.props(styles.miniButton)}
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
