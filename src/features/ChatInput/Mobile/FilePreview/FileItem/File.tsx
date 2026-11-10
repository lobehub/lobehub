import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { RotateCw, Trash } from 'lucide-react';
import { memo } from 'react';

import { FileUploadErrorActions } from '@/business/client/features/FileUploadErrorActions';
import FileIcon from '@/components/FileIcon';
import UploadDetail from '@/features/ChatInput/components/UploadDetail';
import { type UploadFileItem } from '@/types/files';

const styles = stylex.create({
  actions: { position: 'absolute', insetBlockStart: '0', insetInlineEnd: '0' },
  container: {
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    width: '250px',
    height: '64px',
    paddingBlock: '4px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '24px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '8px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  deleteButton: {
    color: '#fff',
    backgroundColor: { 'default': cssVar.colorBgMask, ':hover': cssVar.colorError },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
});

interface FileItemProps extends UploadFileItem {
  onRemove?: () => void;
  onRetry?: () => void;
}

const FileItem = memo<FileItemProps>(
  ({ error, errorCode, id, onRemove, onRetry, file, status, uploadState, tasks }) => {
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.container).className}
        gap={12}
        key={id}
      >
        <FileIcon fileName={file.name} fileType={file.type} />
        <Flexbox style={{ overflow: 'hidden' }}>
          <Text ellipsis>{file.name}</Text>
          <UploadDetail
            error={error}
            size={file.size}
            status={status}
            tasks={tasks}
            uploadState={uploadState}
          />
        </Flexbox>
        <Flexbox horizontal className={stylex.props(styles.actions).className}>
          {status === 'error' && errorCode ? (
            <FileUploadErrorActions compact code={errorCode} />
          ) : status === 'error' ? (
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
      </Flexbox>
    );
  },
);
export default FileItem;
