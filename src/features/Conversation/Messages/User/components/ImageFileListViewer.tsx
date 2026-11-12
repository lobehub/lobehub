import { type ChatImageItem } from '@lobechat/types';
import { PreviewGroup } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import GalleyGrid from '@/components/GalleyGrid';
import ImageItem from '@/components/ImageItem';
import { withLocalMediaPreview } from '@/utils/localMediaPreview';

import { downloadPreviewImage } from '../../components/downloadPreviewImage';

interface FileListProps {
  items: ChatImageItem[];
}

const ImageFileListViewer = memo<FileListProps>(({ items }) => {
  // Images attached in this session render from memory instead of re-downloading.
  const displayItems = useMemo(() => withLocalMediaPreview(items), [items]);

  return (
    <PreviewGroup preview={{ onDownload: downloadPreviewImage }}>
      <GalleyGrid items={displayItems} renderItem={ImageItem} />
    </PreviewGroup>
  );
});

export default ImageFileListViewer;
