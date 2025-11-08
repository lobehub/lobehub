import { ChatFileItem } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { formatSize } from '@/utils/format';

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  container: css`
    cursor: pointer;

    overflow: hidden;

    max-width: 420px;
    padding-block: 8px;
    padding-inline: 12px 32px;
    border: 1px solid ${isDarkMode ? token.colorBorder : token.colorSplit};
    border-radius: 8px;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
}));

const FileItem = memo<ChatFileItem>(({ id, fileType, size, name }) => {
  const { styles } = useStyles();

  const openFilePreview = useChatStore((s) => s.openFilePreview);

  return (
    <Flexbox
      className={styles.container}
      gap={12}
      horizontal
      key={id}
      onClick={() => {
        openFilePreview({ fileId: id });
      }}
    >
      <FileIcon fileName={name} fileType={fileType} />
      <Flexbox style={{ overflow: 'hidden' }}>
        <Text ellipsis>{name}</Text>
        <Text type={'secondary'}>{formatSize(size)}</Text>
      </Flexbox>
    </Flexbox>
  );
});
export default FileItem;
