import { Image } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import type {UploadFileItem} from '@/types/files/upload';

const styles = createStaticStyles(({ css }) => ({
  image: css`
    margin-block: 0 !important;
    box-shadow: none;

    img {
      object-fit: contain;
    }
  `,
  video: css`
    overflow: hidden;
    border-radius: 8px;
  `,
}));

const Content = memo<UploadFileItem>(({ file, previewUrl }) => {
  if (file.type.startsWith('image')) {
    return <Image alt={file.name} classNames={{ wrapper: styles.image }} src={previewUrl} />;
  }

  if (file.type.startsWith('video')) {
    return <video className={styles.video} src={previewUrl} width={'100%'} />;
  }

  return <FileIcon fileName={file.name} fileType={file.type} size={48} />;
});

export default Content;
