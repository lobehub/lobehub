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
        <Flexbox gap={4} key={item.id}>
          <audio controls preload={'metadata'} style={{ minWidth: 280, width: '100%' }}>
            <source src={item.url} />
            {item.alt}
          </audio>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default AudioFileListViewer;
