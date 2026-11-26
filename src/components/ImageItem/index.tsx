import { type ImageProps } from '@lobehub/ui';
import { ActionIcon, Image } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Trash } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { usePlatform } from '@/hooks/usePlatform';
import { sx } from '@/styles/sx';

import { MIN_IMAGE_SIZE } from './style';

const styles = stylex.create({
  deleteButton: {
    color: '#fff',
    backgroundColor: { 'default': cssVar.colorBgMask, ':hover': cssVar.colorError },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  editableImage: {
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: `0 0 0 1px ${cssVar.colorFill} inset`,
  },
  image: { marginBlock: '0' },
});

interface ImageItemProps {
  alt?: string;
  alwaysShowClose?: boolean;
  className?: string;
  editable?: boolean;
  height?: number;
  loading?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  preview?: ImageProps['preview'];
  ratio?: number;
  style?: CSSProperties;
  url?: string;
  width?: number;
}

const ImageItem = memo<ImageItemProps>(
  ({
    className,
    style,
    editable,
    alt,
    onRemove,
    url,
    loading,
    alwaysShowClose,
    preview,
    ratio,
    width,
    height,
  }) => {
    const IMAGE_SIZE = editable ? MIN_IMAGE_SIZE : '100%';
    const { isSafari } = usePlatform();
    const aspectRatio =
      ratio && ratio > 0
        ? ratio
        : width && width > 0 && height && height > 0
          ? width / height
          : undefined;
    /**
     * A message bubble is as wide as its content, and an image that has not loaded yet has no
     * width, so the box would show as a small grey strip and then jump to the image's size.
     * The known intrinsic width sizes it up front (the grid still caps it), and the ratio on the
     * `<img>` itself gives it that box while loading. Inside a grid the width is also capped by
     * the cell's height cap times the ratio, so a tall image stays whole instead of being
     * cropped to a square. Editable thumbnails keep their fixed square.
     */
    const placeholderWidth =
      !editable && aspectRatio && width && width > 0
        ? `min(${width}px, calc(var(--galley-grid-cell-max, ${width / aspectRatio}px) * ${aspectRatio}))`
        : undefined;

    return (
      <Image
        alt={alt || ''}
        alwaysShowActions={alwaysShowClose}
        height={isSafari ? 'auto' : '100%'}
        isLoading={loading}
        preview={preview}
        size={IMAGE_SIZE}
        src={url}
        styles={placeholderWidth ? { image: { aspectRatio } } : undefined}
        actions={
          editable && (
            <ActionIcon
              glass
              className={stylex.props(styles.deleteButton).className}
              icon={Trash}
              size={'small'}
              onClick={(e) => {
                e.stopPropagation();
                onRemove?.();
              }}
            />
          )
        }
        classNames={{
          wrapper: sx(styles.image, editable && styles.editableImage, className).className,
        }}
        style={{
          aspectRatio,
          height: aspectRatio || isSafari ? 'auto' : '100%',
          // the grid's min-height and row stretch would push wide images past their ratio, leaving a blank strip
          alignSelf: aspectRatio ? 'start' : undefined,
          minHeight: aspectRatio ? 'auto' : undefined,
          ...(placeholderWidth ? { maxWidth: '100%', width: placeholderWidth } : { width: '100%' }),
          ...style,
        }}
      />
    );
  },
);

export default ImageItem;
