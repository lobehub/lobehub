import { Image } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import { type UploadFileItem } from '@/types/files/upload';

const styles = stylex.create({
  image: { width: '100%', height: '100%', borderRadius: '2px', objectFit: 'cover' },
  imageRoot: { borderRadius: '2px' },
  imageWrapper: {
    width: '100%',
    height: '100%',
    marginBlock: '0',
    borderRadius: '2px',
    boxShadow: 'none',
  },
  video: { overflow: 'hidden', width: '100%', height: '100%', borderRadius: '2px' },
});

const Content = memo<UploadFileItem>(({ file, previewUrl }) => {
  if (file.type.startsWith('image')) {
    return (
      <Image
        alt={file.name}
        className={stylex.props(styles.imageRoot).className}
        height={20}
        src={previewUrl}
        width={20}
        classNames={{
          image: stylex.props(styles.image).className,
          wrapper: stylex.props(styles.imageWrapper).className,
        }}
      />
    );
  }

  if (file.type.startsWith('video')) {
    return <video {...stylex.props(styles.video)} src={previewUrl} />;
  }

  return <FileIcon fileName={file.name} fileType={file.type} size={16} />;
});

export default Content;
