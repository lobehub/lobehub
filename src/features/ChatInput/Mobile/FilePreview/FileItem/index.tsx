import { type CSSProperties } from 'react';
import { memo } from 'react';

import { useChatInputStore } from '@/features/ChatInput/store';
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
  const contextKey = useChatInputStore((s) => s.contextSelectionKey);

  if (file.type.startsWith('image')) {
    return (
      <Image
        alt={file.name}
        error={status === 'error'}
        errorCode={errorCode}
        loading={status === 'pending'}
        src={previewUrl}
        onRemove={() => {
          removeFile({ contextKey, id });
        }}
        onRetry={() => {
          void retryFile({ contextKey, id });
        }}
      />
    );
  }

  return (
    <File
      {...props}
      onRemove={() => removeFile({ contextKey, id })}
      onRetry={() => {
        void retryFile({ contextKey, id });
      }}
    />
  );
});

export default FileItem;
