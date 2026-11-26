import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { useChatInputUploadKey } from '@/features/ChatInput/hooks/useChatInputUpload';
import { useChatInputStore } from '@/features/ChatInput/store';
import { fileChatSelectors, useFileStore } from '@/store/file';

import ContextList from './ContextList';
import { useContentHeightTransition } from './useContentHeightTransition';

const styles = stylex.create({
  outer: {
    overflow: 'hidden',
    transitionProperty: {
      'default': 'height',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
});

/**
 * Contains the context item to be attached, such as file, image, text, etc.
 * Note: Drag upload is now handled by DragUploadZone in the parent Desktop component.
 *
 * Its height follows the attachments with a transition, so adding the first one or removing
 * the last one does not make the input jump.
 */
const ContextContainer = () => {
  const contextSelectionKey = useChatInputStore((s) => s.contextSelectionKey);
  const uploadContextKey = useChatInputUploadKey();
  const itemCount = useFileStore(
    (s) =>
      fileChatSelectors.chatUploadFileList(uploadContextKey)(s).length +
      fileChatSelectors.chatContextSelections(contextSelectionKey)(s).length,
  );
  const [outerRef, innerRef] = useContentHeightTransition<HTMLDivElement, HTMLDivElement>(
    itemCount,
  );

  return (
    <div ref={outerRef} {...stylex.props(styles.outer)}>
      <Flexbox paddingInline={8} ref={innerRef}>
        <ContextList />
      </Flexbox>
    </div>
  );
};

export default ContextContainer;
