import { Image } from '@lobehub/ui/mdx';
import { type FC } from 'react';

const ImageWrapper: FC<{ alt: string; src: string }> = ({ alt, src, ...rest }) => {
  return <Image alt={alt} src={src} {...rest} />;
};

export default ImageWrapper;
