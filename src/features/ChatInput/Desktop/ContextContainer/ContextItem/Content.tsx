import { Image } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import { type UploadFileItem } from '@/types/files/upload';

const styles = createStaticStyles(({ css }) => ({
  image: css`
    width: 100%;
    height: 100%;
    margin-block: 0 !important;
    box-shadow: none;

    img {
      width: 100%;
      height: 100%;
      border-radius: 4px;
      object-fit: cover;
    }
  `,
  video: css`
    overflow: hidden;
    width: 100%;
    height: 100%;
    border-radius: 4px;
  `,
}));

const Content = memo<UploadFileItem>(({ file, previewUrl }) => {
  if (file.type.startsWith('image')) {
    return <Image alt={file.name} classNames={{ wrapper: styles.image }} src={previewUrl} />;
  }

  if (file.type.startsWith('video')) {
    return <video className={styles.video} src={previewUrl} />;
  }

  return <FileIcon fileName={file.name} fileType={file.type} size={16} />;
});

export default Content;
