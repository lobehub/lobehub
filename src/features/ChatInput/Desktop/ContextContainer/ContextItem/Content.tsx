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
    border-radius: 2px;

    box-shadow: none;

    img {
      width: 100%;
      height: 100%;
      border-radius: 2px;
      object-fit: cover;
    }
  `,
  imageRoot: css`
    border-radius: 2px;
  `,
  video: css`
    overflow: hidden;
    width: 100%;
    height: 100%;
    border-radius: 2px;
  `,
}));

const Content = memo<UploadFileItem>(({ file, previewUrl }) => {
  if (file.type.startsWith('image')) {
    return (
      <Image
        alt={file.name}
        className={styles.imageRoot}
        classNames={{ wrapper: styles.image }}
        height={20}
        src={previewUrl}
        width={20}
      />
    );
  }

  if (file.type.startsWith('video')) {
    return <video className={styles.video} src={previewUrl} />;
  }

  return <FileIcon fileName={file.name} fileType={file.type} size={16} />;
});

export default Content;
