import { PreviewGroup } from '@lobehub/ui';
import { memo } from 'react';

import GalleyGrid from '@/components/GalleyGrid';
import ImageItem from '@/components/ImageItem';

import { downloadPreviewImage } from '../../components/downloadPreviewImage';

interface ImageFileItem {
  alt?: string;
  id: string;
  loading?: boolean;
  onRemove?: (id: string) => void;
  url: string;
}

interface FileListProps {
  items: ImageFileItem[];
}

const ImageFileListViewer = memo<FileListProps>(({ items }) => {
  return (
    <PreviewGroup preview={{ onDownload: downloadPreviewImage }}>
      <GalleyGrid items={items} renderItem={ImageItem} />
    </PreviewGroup>
  );
});

export default ImageFileListViewer;
