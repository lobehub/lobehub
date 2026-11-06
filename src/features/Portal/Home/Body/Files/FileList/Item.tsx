import { type ChatFileItem } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { formatSize } from '@/utils/format';

const styles = stylex.create({
  container: {
    cursor: 'pointer',
    overflow: 'hidden',
    maxWidth: '420px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: '8px',
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
});

const FileItem = memo<ChatFileItem>(({ name, fileType, size, id }) => {
  const openFilePreview = useChatStore((s) => s.openFilePreview);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.container).className}
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
