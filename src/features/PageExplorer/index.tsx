'use client';

import { memo, type ReactNode, useCallback } from 'react';

import { PageEditor } from '@/features/PageEditor';
import { pageActions, pageSelectors, usePageStore } from '@/store/page';

interface PageExplorerProps {
  /** Forwarded to PageEditor. */
  fullWidthHeader?: boolean;
  /**
   * Custom header slot. `null` hides the editor header entirely; any node
   * replaces the built-in `<Header />`. Forwarded to PageEditor.
   */
  header?: ReactNode | null;
  pageId: string;
  /** Forwarded to PageEditor. Mobile has no room for the copilot / comments panel. */
  rightPanel?: boolean;
}

/**
 * Dedicated for the /page route
 *
 * Work together with a sidebar @/features/Pages/PageLayout/Body
 */
const PageExplorer = memo<PageExplorerProps>(({ pageId, header, fullWidthHeader, rightPanel }) => {
  // Get document title and emoji from PageStore
  const document = usePageStore(pageSelectors.getDocumentById(pageId));
  const title = document?.title;
  const emoji = document?.metadata?.emoji as string | undefined;

  // Optimistic update handlers for title and emoji
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      pageActions.updatePageOptimistically(pageId, { title: newTitle });
    },
    [pageId],
  );

  const handleEmojiChange = useCallback(
    (newEmoji: string | undefined) => {
      pageActions.updatePageOptimistically(pageId, { emoji: newEmoji });
    },
    [pageId],
  );

  return (
    <PageEditor
      emoji={emoji}
      fullWidthHeader={fullWidthHeader}
      header={header}
      key={pageId}
      pageId={pageId}
      rightPanel={rightPanel}
      title={title}
      onEmojiChange={handleEmojiChange}
      onTitleChange={handleTitleChange}
    />
  );
});

export default PageExplorer;
