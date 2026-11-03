/**
 * Image adapter — replaces next/image with a plain <img> element.
 * Preserves the most common Next.js Image props for API compat.
 */

import { type CSSProperties, type ImgHTMLAttributes } from 'react';

export interface StaticImageData {
  blurDataURL?: string;
  height: number;
  src: string;
  width: number;
}

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  sizes?: string;
  src: string | StaticImageData;
  unoptimized?: boolean;
}

const Image = ({
  ref,
  src,
  fill,
  priority,
  quality,
  sizes,
  unoptimized,
  style,
  ...rest
}: ImageProps & { ref?: React.RefObject<HTMLImageElement | null> }) => {
  const resolvedSrc = typeof src === 'string' ? src : src.src;

  const fillStyle: CSSProperties | undefined = fill
    ? { height: '100%', left: 0, objectFit: 'cover', position: 'absolute', top: 0, width: '100%' }
    : undefined;

  return <img ref={ref} src={resolvedSrc} style={{ ...fillStyle, ...style }} {...rest} />;
};

Image.displayName = 'Image';

export default Image;
