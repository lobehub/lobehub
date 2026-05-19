'use client';

import { Card, Flexbox } from '@lobehub/ui';
import { Button, Progress, Tag } from 'antd';
import { memo, useMemo } from 'react';
import { MdDownload, MdPlayArrow } from 'react-icons/md';

interface AudioCardProps {
  batch: any;
  generation: any;
}

const AudioCard = memo<AudioCardProps>(({ batch, generation }) => {
  const status = generation.task?.status || 'pending';
  const audioUrl = generation.asset?.url;
  
  const statusColor = useMemo(() => {
    switch (status) {
      case 'pending':
        return 'blue';
      case 'processing':
        return 'orange';
      case 'completed':
        return 'green';
      case 'failed':
        return 'red';
      default:
        return 'default';
    }
  }, [status]);

  return (
    <Card
      style={{
        marginBottom: '12px',
        borderRadius: '8px',
      }}
    >
      <Flexbox gap="md" padding="md">
        <div>
          <h4>{batch.prompt}</h4>
          <p>Music Style: {batch.config?.musicStyle || 'unknown'}</p>
          <p>Duration: {batch.config?.duration || 30}s</p>
        </div>

        <Flexbox horizontal gap="sm" align="center">
          <Tag color={statusColor}>{status.toUpperCase()}</Tag>
        </Flexbox>

        {status === 'processing' && (
          <Progress percent={50} status="active" />
        )}

        {audioUrl && (
          <Flexbox horizontal gap="sm">
            <Button
              icon={<MdPlayArrow />}
              onClick={() => {
                const audio = new Audio(audioUrl);
                audio.play();
              }}
            >
              Play
            </Button>
            <Button
              icon={<MdDownload />}
              onClick={() => {
                const a = document.createElement('a');
                a.href = audioUrl;
                a.download = `audio-${generation.id}.mp3`;
                a.click();
              }}
            >
              Download
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </Card>
  );
});

AudioCard.displayName = 'AudioCard';

export default AudioCard;
