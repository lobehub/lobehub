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
  const { file, id, previewUrl, status } = props;
  const [removeFile] = useFileStore((s) => [s.removeChatUploadFile]);

  if (file.type.startsWith('image')) {
    return (
      <Image
        alt={file.name}
        loading={status === 'pending'}
        src={previewUrl}
        onRemove={() => {
          removeFile(id);
        }}
      />
    );
  }

  return <File onRemove={() => removeFile(id)} {...props} />;
});

export default FileItem;
