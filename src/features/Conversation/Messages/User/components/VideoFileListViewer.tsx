import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import MessageVideo from '@/components/MessageVideo';
import { type ChatVideoItem } from '@/types/index';
import { withLocalMediaPreview } from '@/utils/localMediaPreview';

interface VideoFileListViewerProps {
  items: ChatVideoItem[];
}

const VideoFileListViewer = memo<VideoFileListViewerProps>(({ items }) => {
  // Videos attached in this session play from memory instead of re-downloading.
  const displayItems = useMemo(() => withLocalMediaPreview(items), [items]);

  return (
    <Flexbox gap={8}>
      {displayItems.map((item) => (
        <MessageVideo key={item.id} maxHeight={400} src={item.url} />
      ))}
    </Flexbox>
  );
});

export default VideoFileListViewer;
