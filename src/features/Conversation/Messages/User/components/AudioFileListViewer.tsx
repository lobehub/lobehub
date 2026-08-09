import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AudioPlayer from '@/features/AudioPlayer';
import { type ChatAudioItem } from '@/types/index';

interface AudioFileListViewerProps {
  items: ChatAudioItem[];
}

const AudioFileListViewer = memo<AudioFileListViewerProps>(({ items }) => {
  return (
    <Flexbox gap={8}>
      {items.map((item) => (
        <AudioPlayer alt={item.alt} key={item.id} url={item.url} />
      ))}
    </Flexbox>
  );
});

export default AudioFileListViewer;
