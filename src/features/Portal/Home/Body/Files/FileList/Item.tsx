import { type ChatFileItem } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { formatSize } from '@/utils/format';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;

    overflow: hidden;

    max-width: 420px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 8px;

    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

const FileItem = memo<ChatFileItem>(({ name, fileType, size, id }) => {
  const openFilePreview = useChatStore((s) => s.openFilePreview);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
      gap={8}
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
