import { Flexbox, ScrollShadow } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { AnimatePresence } from 'motion/react';
import { memo } from 'react';

import { useChatInputUploadKey } from '@/features/ChatInput/hooks/useChatInputUpload';
import { useChatInputStore } from '@/features/ChatInput/store';
import { getChatInputImageKey, isImageUpload } from '@/features/ChatInput/utils/imageUploads';
import { fileChatSelectors, useFileStore } from '@/store/file';

import ContextItem from './ContextItem';
import ImageCard from './ContextItem/ImageCard';
import ContextMotionItem, { CONTEXT_ITEM_GAP } from './ContextMotionItem';
import ElementItem from './ElementItem';
import SelectionItem from './SelectionItem';

const styles = stylex.create({ container: { width: '100%' } });

const ContextList = memo(() => {
  const contextSelectionKey = useChatInputStore((s) => s.contextSelectionKey);
  const uploadContextKey = useChatInputUploadKey();
  const inputFilesList = useFileStore(fileChatSelectors.chatUploadFileList(uploadContextKey));
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

  // Stays mounted while empty, so the last attachment can animate out and the container's
  // height can collapse after it.
  const hasItems = inputFilesList.length > 0 || hasSelections;

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
        gap={CONTEXT_ITEM_GAP}
        paddingInline={0}
        style={{ paddingBlockStart: hasItems ? 8 : 0 }}
        wrap={'wrap'}
      >
        <AnimatePresence initial={false}>
          {selectionList.map((item) => (
            <ContextMotionItem key={`selection:${item.id}`}>
              {item.source === 'element' ? <ElementItem {...item} /> : <SelectionItem {...item} />}
            </ContextMotionItem>
          ))}
          {inputFilesList.map((item) => {
            // Keyed by the preview URL when there is one: the id changes from the file name to
            // the server id once the upload finishes, which would remount the card.
            const key = getChatInputImageKey(item);

            return (
              <ContextMotionItem key={`file:${key}`}>
                {isImageUpload(item) ? <ImageCard {...item} /> : <ContextItem {...item} />}
              </ContextMotionItem>
            );
          })}
        </AnimatePresence>
      </Flexbox>
    </ScrollShadow>
  );
});

export default ContextList;
