import type { ImageProps } from '@lobehub/ui';

/** Intrinsic size recorded on an uploaded tool_result image (absent on older messages). */
export interface IntrinsicImageSize {
  height?: number;
  width?: number;
}

/**
 * Size an echoed image's box from its recorded intrinsic size, so the card has
 * its final height before the image loads instead of growing from zero (the
 * conversation would otherwise jump under the reader). Width is the rendered
 * width under `maxHeight`, never upscaled; `aspect-ratio` derives the height
 * and keeps it correct when `maxWidth: 100%` shrinks a wide capture.
 *
 * Older messages carry no size; they get no reservation and keep the previous
 * load-then-grow behaviour.
 */
export const reservedImageProps = (
  { height, width }: IntrinsicImageSize,
  maxHeight: number,
): Pick<ImageProps, 'styles' | 'width'> => {
  if (!width || !height || width <= 0 || height <= 0) return {};

  return {
    styles: { image: { aspectRatio: `${width} / ${height}` } },
    width: Math.round(width * Math.min(1, maxHeight / height)),
  };
};
