'use server';

import { Image } from '@lobehub/ui/mdx';
import { getPlaiceholder } from 'plaiceholder';
import { type FC } from 'react';

import Img from '@/libs/next/Image';

const DEFAULT_WIDTH = 800;

const fetchImage = async (url: string) => {
  const buffer = await fetch(url, { cache: 'force-cache' }).then(async (res) =>
    Buffer.from(await res.arrayBuffer()),
  );
  const {
    base64,
    metadata: { height, width },
  } = await getPlaiceholder(buffer, { format: ['webp'] });
  return {
    base64,
    height: (DEFAULT_WIDTH / width) * height,
  };
};

const ImageWrapper: FC<{ alt: string; src: string }> = async ({ alt, src, ...rest }) => {
  try {
    const { base64, height } = await fetchImage(src);
    return (
      <Image
        alt={alt}
        height={height}
        src={src}
        width={DEFAULT_WIDTH}
        placeholder={
          <Img
            alt={alt}
            height={height}
            src={base64}
            style={{ filter: 'blur(24px)', height: 'auto', scale: 1.2, width: '100%' }}
            width={DEFAULT_WIDTH}
          />
        }
      />
    );
  } catch {
    return <Image alt={alt} src={src} {...rest} />;
  }
};

export default ImageWrapper;
