import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { useChatInputStore } from '@/features/ChatInput/store';
import { fileChatSelectors, useFileStore } from '@/store/file';

import ContextItem from './ContextItem';
import ElementItem from './ElementItem';
import SelectionItem from './SelectionItem';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-x: scroll;
    width: 100%;
  `,
}));

const ContextList = memo(() => {
  const contextSelectionKey = useChatInputStore((s) => s.contextSelectionKey);
  const inputFilesList = useFileStore(fileChatSelectors.chatUploadFileList);
  const showFileList = useFileStore(fileChatSelectors.chatUploadFileListHasItem);
  const rawSelectionList = useFileStore(
    fileChatSelectors.chatContextSelections(contextSelectionKey),
  );
  const showSelectionList = useFileStore(
    fileChatSelectors.chatContextSelectionHasItem(contextSelectionKey),
  );

  // Filter duplicates based on preview content
  const selectionList = rawSelectionList.filter(
    (item, index, self) => index === self.findIndex((t) => t.preview === item.preview),
  );

  const hasSelections = showSelectionList && selectionList.length > 0;

  if (!showFileList && !showSelectionList) return null;
  if (inputFilesList.length === 0 && !hasSelections) return null;

  return (
    <ScrollShadow
      hideScrollBar
      horizontal
      className={styles.container}
      orientation={'horizontal'}
      size={8}
    >
      <Flexbox horizontal gap={4} paddingInline={0} style={{ paddingBlockStart: 8 }} wrap={'wrap'}>
        {selectionList.map((item) =>
          item.source === 'element' ? (
            <ElementItem key={item.id} {...item} />
          ) : (
            <SelectionItem key={item.id} {...item} />
          ),
        )}
        {inputFilesList.map((item) => (
          <ContextItem key={item.id} {...item} />
        ))}
      </Flexbox>
    </ScrollShadow>
  );
});

export default ContextList;
