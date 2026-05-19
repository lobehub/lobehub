'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Slider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { DownloadIcon, PauseIcon, PlayIcon, Volume2Icon } from 'lucide-react';
import { memo, useRef, useState } from 'react';

interface AudioPlayerProps {
  audioId?: string;
  audioUrl?: string;
  title?: string;
}

const useStyles = createStaticStyles(({ css, token }) => ({
  container: css`
    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
  `,
  controls: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  slider: css`
    flex: 1;
  `,
  time: css`
    min-width: 40px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
}));

const AudioPlayer = memo<AudioPlayerProps>(({ audioUrl, title, audioId }) => {
  const { styles } = useStyles();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  if (!audioUrl) {
    return <div className={styles.container}>Audio URL not available</div>;
  }

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = `${title || audioId || 'audio'}.mp3`;
    link.click();
  };

  return (
    <div className={styles.container}>
      <audio
        ref={audioRef}
        src={audioUrl}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
        onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
      />

      <Flexbox vertical gap="sm">
        {title && <div style={{ fontSize: '14px', fontWeight: 500 }}>{title}</div>}

        <Flexbox horizontal className={styles.controls} gap="xs">
          <Button
            icon={<Icon icon={isPlaying ? PauseIcon : PlayIcon} />}
            size="small"
            type="text"
            onClick={handlePlayPause}
          />

          <Slider
            className={styles.slider}
            max={duration || 100}
            style={{ margin: 0 }}
            value={currentTime}
            onChange={(val) => {
              if (audioRef.current) {
                audioRef.current.currentTime = val as number;
              }
            }}
          />

          <span className={styles.time}>
            {Math.floor(currentTime)}s / {Math.floor(duration)}s
          </span>

          <Button
            icon={<Icon icon={Volume2Icon} />}
            size="small"
            type="text"
            onClick={() => handleDownload()}
          />

          <Button
            icon={<Icon icon={DownloadIcon} />}
            size="small"
            type="text"
            onClick={handleDownload}
          />
        </Flexbox>
      </Flexbox>
    </div>
  );
});

AudioPlayer.displayName = 'AudioPlayer';

export default AudioPlayer;
