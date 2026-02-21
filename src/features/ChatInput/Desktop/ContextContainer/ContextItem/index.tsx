import { createRawModal, Flexbox, Tag, Tooltip } from '@lobehub/ui';
import { Progress } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { useEventCallback } from '@/hooks/useEventCallback';
import { useFileStore } from '@/store/file';
import { type UploadFileItem } from '@/types/files/upload';
import { UPLOAD_STATUS_SET } from '@/types/files/upload';

import Content from './Content';
import FilePreviewModal from './FilePreviewModal';
import { getFileBasename } from './utils';

const styles = createStaticStyles(({ css }) => ({
  closeBtn: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorError};
      background: ${cssVar.colorErrorBg};
    }
  `,
  icon: css`
    position: relative;

    flex-shrink: 0;

    width: 18px;
    height: 18px;
    border-radius: 4px;

    img,
    video {
      width: 100%;
      height: 100%;
      border-radius: 4px;
      object-fit: cover;
    }
  `,
  name: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  progress: css`
    position: absolute;
    inset: -3px;

    display: flex;
    align-items: center;
    justify-content: center;

    border-radius: 4px;

    background: ${cssVar.colorBgMask};
  `,
}));

type FileItemProps = UploadFileItem;

const ContextItem = memo<FileItemProps>((props) => {
  const { file, id, status, uploadState } = props;
  const [removeChatUploadFile] = useFileStore((s) => [s.removeChatUploadFile]);

  const basename = getFileBasename(file.name);
  const isUploading = UPLOAD_STATUS_SET.has(status);
  const progress = uploadState?.progress ?? 0;

  const handleClick = useEventCallback(() => {
    createRawModal(FilePreviewModal, {
      file: props,
    });
  });

  const handleClose = useEventCallback(() => {
    removeChatUploadFile(id);
  });
  return (
    <Tag closable size={'large'} onClick={handleClick} onClose={handleClose}>
      <Flexbox className={styles.icon}>
        <Content {...props} />
        {isUploading && (
          <div className={styles.progress}>
            <Progress percent={progress} showInfo={false} size={14} strokeWidth={2} type="circle" />
          </div>
        )}
      </Flexbox>
      <Tooltip title={file.name}>
        <span className={styles.name}>{basename}</span>
      </Tooltip>
    </Tag>
  );
});

export default ContextItem;
