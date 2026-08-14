import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AudioPlayer from '@/features/AudioPlayer';
import { type ChatAudioItem } from '@/types/index';

interface AudioFileListViewerProps {
  items: ChatAudioItem[];
  messageId: string;
}

const AudioFileListViewer = memo<AudioFileListViewerProps>(({ items, messageId }) => {
  return (
    <Flexbox gap={8}>
      {items.map((item) => (
        <AudioPlayer
          alt={item.alt}
          durationMs={item.durationMs}
          key={item.id}
          messageId={messageId}
          url={item.url}
        />
      ))}
    </Flexbox>
  );
});

export default AudioFileListViewer;
