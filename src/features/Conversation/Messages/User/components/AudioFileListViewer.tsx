import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { type ChatAudioItem } from '@/types/index';

interface AudioFileListViewerProps {
  items: ChatAudioItem[];
}

const AudioFileListViewer = memo<AudioFileListViewerProps>(({ items }) => {
  return (
    <Flexbox gap={8}>
      {items.map((item) => (
        <audio controls key={item.id} style={{ maxWidth: '100%', width: 360 }}>
          <source src={item.url} />
          {item.alt}
        </audio>
      ))}
    </Flexbox>
  );
});

export default AudioFileListViewer;
