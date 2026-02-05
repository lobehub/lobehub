import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import type {ChatVideoItem} from '@/types/index';

interface VideoFileListViewerProps {
  items: ChatVideoItem[];
}

const VideoFileListViewer = memo<VideoFileListViewerProps>(({ items }) => {
  return (
    <Flexbox gap={8}>
      {items.map((item) => (
        <video
          controls
          key={item.id}
          style={{
            borderRadius: 8,
            maxHeight: 400,
            maxWidth: '100%',
          }}
        >
          <source src={item.url} />
          {item.alt}
        </video>
      ))}
    </Flexbox>
  );
});

export default VideoFileListViewer;
