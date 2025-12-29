'use client';

import { Block, Center, Flexbox, Image, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import Time from '@/app/[variants]/(main)/home/features/components/Time';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import FileIcon from '@/components/FileIcon';
import { type FileListItem } from '@/types/files';
import { formatSize } from '@/utils/format';

const IMAGE_FILE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

interface RecentResourceItemProps {
  file: FileListItem;
}

const RecentResourceItem = memo<RecentResourceItemProps>(({ file }) => {
  const isImage = IMAGE_FILE_TYPES.has(file.fileType);

  return (
    <Block
      clickable
      flex={'none'}
      height={RECENT_BLOCK_SIZE.RESOURCE.HEIGHT}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        overflow: 'hidden',
      }}
      variant={'outlined'}
      width={RECENT_BLOCK_SIZE.RESOURCE.WIDTH}
    >
      <Center
        flex={'none'}
        height={126}
        style={{ background: cssVar.colorFillTertiary, overflow: 'hidden' }}
      >
        {isImage && file.url ? (
          <Image
            alt={file.name}
            height={'100%'}
            objectFit={'cover'}
            preview={false}
            src={file.url}
            style={{
              borderRadius: 0,
              width: '100%',
            }}
            width={'100%'}
          />
        ) : (
          <FileIcon fileName={file.name} fileType={file.fileType} size={48} />
        )}
      </Center>

      {/* File Info */}
      <Flexbox flex={1} gap={6} justify={'space-between'} padding={12}>
        <Text ellipsis={{ rows: 2 }} fontSize={13} style={{ lineHeight: 1.4 }} weight={500}>
          {file.name}
        </Text>
        <Flexbox align={'center'} gap={8} horizontal>
          <Time date={file.updatedAt} />
          <Text ellipsis fontSize={12} type={'secondary'}>
            {formatSize(file.size)}
          </Text>
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

export default RecentResourceItem;
