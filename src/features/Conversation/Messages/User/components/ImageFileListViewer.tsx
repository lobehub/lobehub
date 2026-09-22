import { type ChatImageItem } from '@lobechat/types';
import { PreviewGroup } from '@lobehub/ui';
import { memo } from 'react';

import GalleyGrid from '@/components/GalleyGrid';
import ImageItem from '@/components/ImageItem';

import { downloadPreviewImage } from '../../components/downloadPreviewImage';

interface FileListProps {
  items: ChatImageItem[];
}

const ImageFileListViewer = memo<FileListProps>(({ items }) => {
  return (
    <PreviewGroup preview={{ onDownload: downloadPreviewImage }}>
      <GalleyGrid items={items} renderItem={ImageItem} />
    </PreviewGroup>
  );
});

export default ImageFileListViewer;
