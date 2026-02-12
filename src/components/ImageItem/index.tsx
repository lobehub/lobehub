import { type ImageProps } from '@lobehub/ui';
import { ActionIcon, Image } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Trash } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { usePlatform } from '@/hooks/usePlatform';

import { MIN_IMAGE_SIZE } from './style';

const styles = createStaticStyles(({ css }) => ({
  deleteButton: css`
    color: #fff;
    background: ${cssVar.colorBgMask};

    &:hover {
      background: ${cssVar.colorError};
    }
  `,
  editableImage: css`
    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 0 1px ${cssVar.colorFill} inset;
  `,
  image: css`
    margin-block: 0 !important;

    .ant-image {
      height: 100% !important;

      img {
        height: 100% !important;
      }
    }
  `,
}));

interface ImageItemProps {
  alt?: string;
  alwaysShowClose?: boolean;
  className?: string;
  editable?: boolean;
  loading?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  preview?: ImageProps['preview'];
  style?: CSSProperties;
  url?: string;
}

const ImageItem = memo<ImageItemProps>(
  ({ className, style, editable, alt, onRemove, url, loading, alwaysShowClose, preview }) => {
    const IMAGE_SIZE = editable ? MIN_IMAGE_SIZE : '100%';
    const { isSafari } = usePlatform();

    return (
      <Image
        alt={alt || ''}
        alwaysShowActions={alwaysShowClose}
        classNames={{ wrapper: cx(styles.image, editable && styles.editableImage, className) }}
        height={isSafari ? 'auto' : '100%'}
        isLoading={loading}
        preview={preview}
        size={IMAGE_SIZE as any}
        src={url}
        style={{ height: isSafari ? 'auto' : '100%', width: '100%', ...style }}
        actions={
          editable && (
            <ActionIcon
              glass
              className={styles.deleteButton}
              icon={Trash}
              size={'small'}
              onClick={(e) => {
                e.stopPropagation();
                onRemove?.();
              }}
            />
          )
        }
      />
    );
  },
);

export default ImageItem;
