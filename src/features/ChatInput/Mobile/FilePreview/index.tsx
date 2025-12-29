import { Flexbox, PreviewGroup, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { useChatInputStore } from '@/features/ChatInput/store';
import { filesSelectors, useFileStore } from '@/store/file';

import FileItem from './FileItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-x: scroll;
    width: 100%;
  `,
}));

const FilePreview = memo(() => {
  const expand = useChatInputStore((s) => s.expand);
  const list = useFileStore(filesSelectors.chatUploadFileList, isEqual);
  if (!list || list?.length === 0) return null;

  return (
    <ScrollShadow
      className={styles.container}
      hideScrollBar
      horizontal
      orientation={'horizontal'}
      size={8}
    >
      <Flexbox gap={6} horizontal paddingBlock={8} paddingInline={expand ? 0 : 12}>
        <PreviewGroup>
          {list.map((i) => (
            <FileItem {...i} key={i.id} loading={i.status === 'pending'} />
          ))}
        </PreviewGroup>
      </Flexbox>
    </ScrollShadow>
  );
});

export default FilePreview;
