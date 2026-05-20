'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Music2Icon } from 'lucide-react';
import { memo } from 'react';

import { useAudioStore } from '@/store/audio';

import AudioCard from './AudioCard';

const useStyles = createStaticStyles(({ css, token }) => ({
  empty: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    color: ${token.colorTextQuaternary};
    gap: 12px;
  `,
  feed: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    overflow-y: auto;
    height: 100%;
  `,
}));

const GenerationFeed = memo(() => {
  const { styles } = useStyles();
  const audioTracks = useAudioStore((s) => s.audioTracks);
  const generationError = useAudioStore((s) => s.generationError);

  const tracks = Object.values(audioTracks).sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  );

  if (tracks.length === 0) {
    return (
      <div className={styles.empty}>
        <Music2Icon size={40} strokeWidth={1} />
        <Text type="secondary">Your generated tracks will appear here</Text>
        {generationError && (
          <Text type="danger" style={{ fontSize: 13, maxWidth: 320, textAlign: 'center' }}>
            {generationError}
          </Text>
        )}
      </div>
    );
  }

  return (
    <div className={styles.feed}>
      {generationError && (
        <Text type="danger" style={{ fontSize: 13 }}>
          {generationError}
        </Text>
      )}
      <Flexbox gap={16}>
        {tracks.map((track) => (
          <AudioCard key={track.taskId} track={track} />
        ))}
      </Flexbox>
    </div>
  );
});

GenerationFeed.displayName = 'AudioGenerationFeed';

export default GenerationFeed;
