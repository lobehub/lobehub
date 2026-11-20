import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import MessageVideo from '@/components/MessageVideo';
import { type ChatVideoItem } from '@/types/index';

interface VideoFileListViewerProps {
  items: ChatVideoItem[];
}

const VideoFileListViewer = memo<VideoFileListViewerProps>(({ items }) => {
  return (
    <Flexbox gap={8}>
      {items.map((item) => (
        <MessageVideo key={item.id} maxHeight={400} src={item.url} />
      ))}
    </Flexbox>
  );
});

export default VideoFileListViewer;
