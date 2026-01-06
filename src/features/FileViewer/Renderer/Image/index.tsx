'use client';

import { Center } from '@lobehub/ui';
import { memo } from 'react';

interface ImageViewerProps {
  fileId: string;
  url: string | null;
}

const ImageViewer = memo<ImageViewerProps>(({ url }) => {
  if (!url) return null;

  return (
    <Center height={'100%'} width={'100%'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="Image preview"
        src={url}
        style={{
          height: '100%',
          objectFit: 'contain',
          overflow: 'hidden',
          width: '100%',
        }}
      />
    </Center>
  );
});

export default ImageViewer;
