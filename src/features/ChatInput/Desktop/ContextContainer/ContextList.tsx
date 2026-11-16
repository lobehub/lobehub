import { Flexbox, ScrollShadow } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useChatInputUploadKey } from '@/features/ChatInput/hooks/useChatInputUpload';
import { useChatInputStore } from '@/features/ChatInput/store';
import { isImageUpload } from '@/features/ChatInput/utils/imageUploads';
import { fileChatSelectors, useFileStore } from '@/store/file';

import ContextItem from './ContextItem';
import ImageCard from './ContextItem/ImageCard';
import ElementItem from './ElementItem';
import SelectionItem from './SelectionItem';

const styles = stylex.create({ container: { overflowX: 'scroll', width: '100%' } });

const ContextList = memo(() => {
  const contextSelectionKey = useChatInputStore((s) => s.contextSelectionKey);
  const uploadContextKey = useChatInputUploadKey();
  const inputFilesList = useFileStore(fileChatSelectors.chatUploadFileList(uploadContextKey));
  const showFileList = useFileStore(fileChatSelectors.chatUploadFileListHasItem(uploadContextKey));
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
      className={stylex.props(styles.container).className}
      orientation={'horizontal'}
      size={8}
    >
      <Flexbox
        horizontal
        align={'flex-end'}
        gap={8}
        paddingInline={0}
        style={{ paddingBlockStart: 8 }}
        wrap={'wrap'}
      >
        {selectionList.map((item) =>
          item.source === 'element' ? (
            <ElementItem key={item.id} {...item} />
          ) : (
            <SelectionItem key={item.id} {...item} />
          ),
        )}
        {inputFilesList.map((item) => {
          // Keyed by the preview URL when there is one: the id changes from the file name to
          // the server id once the upload finishes, which would remount the card.
          const key = item.previewUrl ?? item.id;

          return isImageUpload(item) ? (
            <ImageCard key={key} {...item} />
          ) : (
            <ContextItem key={key} {...item} />
          );
        })}
      </Flexbox>
    </ScrollShadow>
  );
});

export default ContextList;
