import { ActionIcon, Flexbox, Image } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { RotateCw, Trash } from 'lucide-react';
import { memo } from 'react';

import { FileUploadErrorActions } from '@/business/client/features/FileUploadErrorActions';

import { MIN_IMAGE_SIZE } from './style';

// `image` used `!important` to beat lobe-ui's Image wrapper; that CSS is layered, so the
// unlayered StyleX rules win without it.
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
  image: { width: '64px', height: '64px', marginBlock: '0' },
});

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
        classNames={{ wrapper: stylex.props(styles.image, styles.editableImage).className }}
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
                className={stylex.props(styles.deleteButton).className}
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
              className={stylex.props(styles.deleteButton).className}
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
