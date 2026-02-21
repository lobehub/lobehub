'use client';

import { Center } from '@lobehub/ui';
import { memo, useState } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

interface ImageViewerProps {
  fileId: string;
  url: string | null;
}

const ImageViewer = memo<ImageViewerProps>(({ url }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  if (!url) return null;

  return (
    <Center height={'100%'} width={'100%'}>
      {!isLoaded && <NeuralNetworkLoading size={36} />}
      { }
      <img
        alt="Image preview"
        src={url}
        style={{
          display: isLoaded ? 'block' : 'none',
          height: '100%',
          objectFit: 'contain',
          overflow: 'hidden',
          width: '100%',
        }}
        onLoad={() => setIsLoaded(true)}
      />
    </Center>
  );
});

export default ImageViewer;
