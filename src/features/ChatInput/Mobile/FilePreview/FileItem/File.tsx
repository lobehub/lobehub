import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Trash } from 'lucide-react';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import UploadDetail from '@/features/ChatInput/components/UploadDetail';
import { type UploadFileItem } from '@/types/files';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    width: 250px;
    height: 64px;
    padding-block: 4px;
    padding-inline: 8px 24px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;

    background: ${cssVar.colorFillTertiary};
  `,
  deleteButton: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;

    color: #fff;

    background: ${cssVar.colorBgMask};

    &:hover {
      background: ${cssVar.colorError};
    }
  `,
}));

interface FileItemProps extends UploadFileItem {
  onRemove?: () => void;
}

const FileItem = memo<FileItemProps>(({ id, onRemove, file, status, uploadState, tasks }) => {
  return (
    <Flexbox horizontal align={'center'} className={styles.container} gap={12} key={id}>
      <FileIcon fileName={file.name} fileType={file.type} />
      <Flexbox style={{ overflow: 'hidden' }}>
        <Text ellipsis>{file.name}</Text>
        <UploadDetail size={file.size} status={status} tasks={tasks} uploadState={uploadState} />
      </Flexbox>
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
  );
});
export default FileItem;
