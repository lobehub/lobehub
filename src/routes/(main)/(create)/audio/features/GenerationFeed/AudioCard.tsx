'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { Progress, Skeleton } from 'antd';
import { createStaticStyles } from 'antd-style';
import { AlertCircleIcon, Music2Icon } from 'lucide-react';
import { memo } from 'react';

import { type AudioTrack } from '@/store/audio/slices/createAudio/initialState';

import MusicPlayer from './MusicPlayer';

const useStyles = createStaticStyles(({ css, token }) => ({
  card: css`
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;
    padding: 16px;
    width: 100%;
    transition: box-shadow 0.2s;

    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }
  `,
  prompt: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  `,
  loadingWave: css`
    display: flex;
    align-items: center;
    gap: 3px;
    height: 32px;
    padding: 4px 0;
  `,
  wavebar: css`
    width: 4px;
    border-radius: 2px;
    background: ${token.colorPrimary};
    opacity: 0.6;
    animation: wavePulse 1.2s ease-in-out infinite;

    &:nth-child(2n) {
      animation-delay: 0.2s;
    }
    &:nth-child(3n) {
      animation-delay: 0.4s;
    }
    &:nth-child(4n) {
      animation-delay: 0.6s;
    }

    @keyframes wavePulse {
      0%, 100% { height: 6px; opacity: 0.3; }
      50% { height: 24px; opacity: 0.9; }
    }
  `,
}));

interface AudioCardProps {
  track: AudioTrack;
}

const STATUS_LABELS: Record<string, { color: string; label: string }> = {
  pending: { color: 'blue', label: 'Queued' },
  processing: { color: 'orange', label: 'Generating' },
  completed: { color: 'green', label: 'Ready' },
  failed: { color: 'red', label: 'Failed' },
};

const AudioCard = memo<AudioCardProps>(({ track }) => {
  const { styles } = useStyles();
  const statusInfo = STATUS_LABELS[track.status] ?? STATUS_LABELS.pending;
  const showPlayer =
    (track.status === 'completed' || track.canPlayEarly) && !!track.audioUrl;

  return (
    <div className={styles.card}>
      {/* Header */}
      <Flexbox align="center" gap={10} horizontal style={{ marginBottom: 12 }}>
        <Music2Icon size={16} />
        <div className={styles.prompt}>
          {track.title || track.prompt}
        </div>
        <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
      </Flexbox>

      {/* Content area */}
      {track.status === 'failed' ? (
        <Flexbox align="center" gap={8} horizontal>
          <AlertCircleIcon color="var(--ant-color-error)" size={16} />
          <Text type="danger" style={{ fontSize: 13 }}>
            {track.status === 'failed' ? 'Generation failed. Please try again.' : 'Unknown error'}
          </Text>
        </Flexbox>
      ) : showPlayer ? (
        <MusicPlayer
          audioUrl={track.audioUrl!}
          imageUrl={track.imageUrl}
          title={track.title || undefined}
        />
      ) : (
        <>
          {/* Animated waveform placeholder while loading */}
          <div className={styles.loadingWave}>
            {Array.from({ length: 24 }, (_, i) => (
              <div
                key={i}
                className={styles.wavebar}
                style={{
                  animationDelay: `${(i % 4) * 0.15}s`,
                  height: `${6 + ((i * 7) % 18)}px`,
                }}
              />
            ))}
          </div>

          <Progress
            percent={track.progress}
            showInfo={false}
            size="small"
            status="active"
            strokeColor={{ '0%': '#667eea', '100%': '#764ba2' }}
            style={{ marginTop: 10 }}
          />

          <Text style={{ fontSize: 12, marginTop: 6 }} type="secondary">
            {track.progress < 25
              ? 'Starting up...'
              : track.progress < 60
                ? 'Composing your track...'
                : 'Finalizing audio...'}
            {' '}This usually takes 20–60 seconds.
          </Text>
        </>
      )}
    </div>
  );
});

AudioCard.displayName = 'AudioCard';

export default AudioCard;
