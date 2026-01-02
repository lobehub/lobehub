import { PreviewGroup } from '@lobehub/ui';
import { memo } from 'react';

import GalleyGrid from '@/components/GalleyGrid';
import ImageItem from '@/components/ImageItem';

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
    <PreviewGroup>
      <GalleyGrid items={items} renderItem={ImageItem} />
    </PreviewGroup>
  );
});

export default ImageFileListViewer;
