import { type ChatImageItem } from '@lobechat/types';
import { PreviewGroup } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import GalleyGrid from '@/components/GalleyGrid';
import ImageItem from '@/components/ImageItem';
import { getLocalImagePreview } from '@/utils/localImagePreview';

import { downloadPreviewImage } from '../../components/downloadPreviewImage';

interface FileListProps {
  items: ChatImageItem[];
}

const ImageFileListViewer = memo<FileListProps>(({ items }) => {
  // Images this tab just uploaded show from their local copy, so a sent message does not
  // wait for its images to download.
  const { shown, preview } = useMemo(() => {
    const uploadedUrls = new Map<string, string>();
    const shown = items.map((item) => {
      const local = getLocalImagePreview(item.id);
      if (!local) return item;
      uploadedUrls.set(local, item.url);
      return { ...item, url: local };
    });
    // Downloads still go through the uploaded file, which carries its stored name.
    const onDownload = (source: string) => downloadPreviewImage(uploadedUrls.get(source) ?? source);
    return { preview: { onDownload }, shown };
  }, [items]);

  return (
    <PreviewGroup preview={preview}>
      <GalleyGrid items={shown} renderItem={ImageItem} />
    </PreviewGroup>
  );
});

export default ImageFileListViewer;
