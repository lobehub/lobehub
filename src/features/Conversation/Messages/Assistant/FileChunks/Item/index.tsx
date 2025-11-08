import { ChatFileChunk } from '@lobechat/types';
import { Text, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import FileIcon from '@/components/FileIcon';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';

import { useStyles } from './style';

export interface ChunkItemProps extends ChatFileChunk {
  index: number;
}

const ChunkItem = memo<ChunkItemProps>(({ id, fileId, similarity, text, filename, fileType }) => {
  const { styles, cx } = useStyles();
  const openFilePreview = useChatStore((s) => s.openFilePreview);

  const isMobile = useIsMobile();
  return (
    <Flexbox
      align={'center'}
      className={cx(styles.container, isMobile && styles.mobile)}
      gap={4}
      horizontal
      key={id}
      onClick={(e) => {
        e.stopPropagation();
        openFilePreview({ chunkId: id, chunkText: text, fileId });
      }}
    >
      <FileIcon fileName={filename} fileType={fileType} size={20} variant={'raw'} />
      <Flexbox gap={12} horizontal justify={'space-between'} style={{ maxWidth: 200 }}>
        <Text ellipsis>{filename}</Text>
        {/*<Typography.Text*/}
        {/*  ellipsis={{ suffix: '...' }}*/}
        {/*  style={{ fontSize: 12, lineHeight: 1 }}*/}
        {/*  type={'secondary'}*/}
        {/*>*/}
        {/*  {text}*/}
        {/*</Typography.Text>*/}
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
