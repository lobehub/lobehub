'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

const useStyles = createStaticStyles(({ css, token }) => ({
  container: css`
    background: ${token.colorFillSecondary};
    border-radius: 12px;
    padding: 12px 16px;
    width: 100%;
  `,
  waveform: css`
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    cursor: pointer;
    flex: 1;
    overflow: hidden;
  `,
  bar: css`
    width: 3px;
    border-radius: 2px;
    background: ${token.colorPrimary};
    opacity: 0.5;
    transition: opacity 0.15s;
    &.active {
      opacity: 1;
    }
    &.played {
      opacity: 0.8;
    }
  `,
  progress: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
    min-width: 72px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  `,
  title: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
}));

interface MusicPlayerProps {
  audioUrl: string;
  title?: string;
  imageUrl?: string;
  onDownload?: () => void;
}

const BAR_COUNT = 40;

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const MusicPlayer = memo<MusicPlayerProps>(({ audioUrl, title, onDownload }) => {
  const { styles } = useStyles();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bars] = useState(() =>
    Array.from({ length: BAR_COUNT }, () => 0.15 + Math.random() * 0.85),
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('loadedmetadata', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('loadedmetadata', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      await audio.play().catch(() => null);
    }
  }, [playing]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !muted;
    setMuted(!muted);
  }, [muted]);

  const handleWaveformClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      audio.currentTime = ratio * duration;
    },
    [duration],
  );

  const handleDownload = useCallback(() => {
    if (onDownload) {
      onDownload();
      return;
    }
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${title || 'track'}.mp3`;
    a.click();
  }, [audioUrl, title, onDownload]);

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className={styles.container}>
      <audio ref={audioRef} preload="metadata" src={audioUrl} />

      {title && (
        <div className={styles.title} style={{ marginBottom: 10 }}>
          {title}
        </div>
      )}

      <Flexbox align="center" gap={8} horizontal>
        {/* Play/Pause */}
        <ActionIcon
          active={playing}
          icon={playing ? PauseIcon : PlayIcon}
          size={{ blockSize: 32, fontSize: 16 }}
          onClick={togglePlay}
        />

        {/* Waveform */}
        <div className={styles.waveform} onClick={handleWaveformClick}>
          {bars.map((height, i) => {
            const barProgress = i / BAR_COUNT;
            const isActive = playing && Math.abs(barProgress - progress) < 0.05;
            const isPlayed = barProgress <= progress;
            return (
              <div
                key={i}
                className={[
                  styles.bar,
                  isActive ? 'active' : '',
                  isPlayed ? 'played' : '',
                ].join(' ')}
                style={{
                  height: `${Math.max(4, height * 32)}px`,
                  animationDelay: `${i * 30}ms`,
                }}
              />
            );
          })}
        </div>

        {/* Time */}
        <div className={styles.progress}>
          {formatTime(currentTime)}{duration > 0 ? ` / ${formatTime(duration)}` : ''}
        </div>

        {/* Mute */}
        <ActionIcon
          icon={muted ? VolumeXIcon : Volume2Icon}
          size={{ blockSize: 28, fontSize: 14 }}
          onClick={toggleMute}
        />

        {/* Download */}
        <ActionIcon
          icon={DownloadIcon}
          size={{ blockSize: 28, fontSize: 14 }}
          title="Download"
          onClick={handleDownload}
        />
      </Flexbox>
    </div>
  );
});

MusicPlayer.displayName = 'MusicPlayer';

export default MusicPlayer;
