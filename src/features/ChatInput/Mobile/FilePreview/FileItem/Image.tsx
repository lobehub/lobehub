import { ActionIcon, Flexbox, Image } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { RotateCw, Trash } from 'lucide-react';
import { memo } from 'react';

import { FileUploadErrorActions } from '@/business/client/features/FileUploadErrorActions';

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
    width: 64px !important;
    height: 64px !important;
    margin-block: 0 !important;
  `,
}));

interface FileItemProps {
  alt?: string;
  error?: boolean;
  errorCode?: string;
  loading?: boolean;
  onRemove?: () => void;
  onRetry?: () => void;
  src?: string;
}

const FileItem = memo<FileItemProps>(
  ({ alt, error, errorCode, onRemove, onRetry, src, loading }) => {
    const IMAGE_SIZE = MIN_IMAGE_SIZE;

    return (
      <Image
        alwaysShowActions
        alt={alt || ''}
        classNames={{ wrapper: cx(styles.image, styles.editableImage) }}
        height={64}
        isLoading={loading}
        objectFit={'cover'}
        size={IMAGE_SIZE}
        src={src}
        width={64}
        actions={
          <Flexbox horizontal>
            {error && errorCode ? (
              <FileUploadErrorActions compact code={errorCode} />
            ) : error ? (
              <ActionIcon
                glass
                className={styles.deleteButton}
                icon={RotateCw}
                size={'small'}
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry?.();
                }}
              />
            ) : null}
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
          </Flexbox>
        }
      />
    );
  },
);

export default FileItem;
