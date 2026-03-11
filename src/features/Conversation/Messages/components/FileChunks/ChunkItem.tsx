import { type ChatFileChunk } from '@lobechat/types';
import { Center, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import { useIsDark } from '@/hooks/useIsDark';
import { useChatStore } from '@/store/chat';

import { styles } from './style';

export interface ChunkItemProps extends ChatFileChunk {
  index: number;
}

const ChunkItem = memo<ChunkItemProps>(({ id, fileId, similarity, text, filename, fileType }) => {
  const isDarkMode = useIsDark();
  // Note: openFilePreview is a portal action, kept in ChatStore as it's a global UI state
  const openFilePreview = useChatStore((s) => s.openFilePreview);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.container, isDarkMode ? styles.containerDark : styles.containerLight)}
      gap={4}
      key={id}
      onClick={(e) => {
        e.stopPropagation();
        openFilePreview({ chunkId: id, chunkText: text, fileId });
      }}
    >
      <FileIcon fileName={filename} fileType={fileType} size={20} variant={'raw'} />
      <Flexbox horizontal gap={12} justify={'space-between'} style={{ maxWidth: 200 }}>
        <Text ellipsis>{filename}</Text>
        {similarity && (
          <Tooltip title={similarity}>
            <Center className={styles.badge}>{similarity.toFixed(1)}</Center>
          </Tooltip>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default ChunkItem;
