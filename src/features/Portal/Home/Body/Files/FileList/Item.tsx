import { ChatFileItem } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { formatSize } from '@/utils/format';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    cursor: pointer;

    overflow: hidden;

    max-width: 420px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 8px;

    background: ${token.colorFillTertiary};

    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
}));

const FileItem = memo<ChatFileItem>(({ name, fileType, size, id }) => {
  const { styles } = useStyles();
  const openFilePreview = useChatStore((s) => s.openFilePreview);

  return (
    <Flexbox
      align={'center'}
      className={styles.container}
      gap={8}
      horizontal
      onClick={() => {
        openFilePreview({ fileId: id });
      }}
    >
      <FileIcon fileName={name} fileType={fileType} />
      <Flexbox>
        <Text ellipsis={{ tooltip: true }}>{name}</Text>
        <Text type={'secondary'}>{formatSize(size)}</Text>
      </Flexbox>
    </Flexbox>
  );
});

export default FileItem;
