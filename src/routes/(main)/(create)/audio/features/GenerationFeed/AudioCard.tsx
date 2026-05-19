'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Card, Progress, Tag } from 'antd';
import { DownloadIcon, PlayIcon } from 'lucide-react';
import { memo, useMemo } from 'react';

interface AudioCardProps {
  batch: any;
  generation: any;
}

const AudioCard = memo<AudioCardProps>(({ batch, generation }) => {
  const status = generation.task?.status || 'pending';
  const audioUrl = generation.asset?.url;

  const statusColor = useMemo(() => {
    switch (status) {
      case 'pending': {
        return 'blue';
      }
      case 'processing': {
        return 'orange';
      }
      case 'completed': {
        return 'green';
      }
      case 'failed': {
        return 'red';
      }
      default: {
        return 'default';
      }
    }
  }, [status]);

  return (
    <Card
      size="small"
      style={{ marginBottom: '12px' }}
      title={
        <Flexbox horizontal align="center" justify="space-between">
          <span>{generation.prompt?.slice(0, 50)}</span>
          <Tag color={statusColor}>{status}</Tag>
        </Flexbox>
      }
    >
      <Flexbox vertical gap="sm">
        <div style={{ fontSize: '12px', color: '#999' }}>
          Style: {generation.musicStyle || 'auto'} | Duration: {generation.duration}s
        </div>

        {status === 'processing' && <Progress percent={50} status="active" />}

        {audioUrl && (
          <Flexbox horizontal gap="sm">
            <Button
              icon={<Icon icon={PlayIcon} />}
              onClick={() => {
                const audio = new Audio(audioUrl);
                audio.play();
              }}
            >
              Play
            </Button>
            <Button
              icon={<Icon icon={DownloadIcon} />}
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

export default AudioCard;
