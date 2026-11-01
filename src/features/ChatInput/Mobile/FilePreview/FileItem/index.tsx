import { type CSSProperties } from 'react';
import { memo } from 'react';

import { useFileStore } from '@/store/file';
import { type UploadFileItem } from '@/types/files';

import File from './File';
import Image from './Image';

interface FileItemProps extends UploadFileItem {
  alt?: string;
  className?: string;
  loading?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  style?: CSSProperties;
  url?: string;
}

const FileItem = memo<FileItemProps>((props) => {
  const { errorCode, file, id, previewUrl, status } = props;
  const [removeFile, retryFile] = useFileStore((s) => [
    s.removeChatUploadFile,
    s.retryChatUploadFile,
  ]);

  if (file.type.startsWith('image')) {
    return (
      <Image
        alt={file.name}
        error={status === 'error'}
        errorCode={errorCode}
        loading={status === 'pending'}
        src={previewUrl}
        onRemove={() => {
          removeFile(id);
        }}
        onRetry={() => {
          void retryFile(id);
        }}
      />
    );
  }

  return (
    <File
      {...props}
      onRemove={() => removeFile(id)}
      onRetry={() => {
        void retryFile(id);
      }}
    />
  );
});

export default FileItem;
