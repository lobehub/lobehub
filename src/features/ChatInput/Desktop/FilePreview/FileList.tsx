import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { useChatInputStore } from '@/features/ChatInput/store';
import { fileChatSelectors, useFileStore } from '@/store/file';

import FileItem from './FileItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-x: scroll;
    width: 100%;
  `,
}));

const FileList = memo(() => {
  const expand = useChatInputStore((s) => s.expand);

  const inputFilesList = useFileStore(fileChatSelectors.chatUploadFileList);
  const showFileList = useFileStore(fileChatSelectors.chatUploadFileListHasItem);

  if (!inputFilesList.length || !showFileList) return null;

  return (
    <ScrollShadow
      hideScrollBar
      horizontal
      className={styles.container}
      orientation={'horizontal'}
      size={8}
    >
      <Flexbox horizontal gap={6} paddingBlock={8} paddingInline={expand ? 0 : 12}>
        {inputFilesList.map((item) => (
          <FileItem key={item.id} {...item} />
        ))}
      </Flexbox>
    </ScrollShadow>
  );
});

export default FileList;
