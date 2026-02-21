'use client';

import { memo, useCallback } from 'react';

import { PageEditor } from '@/features/PageEditor';
import { pageSelectors, usePageStore } from '@/store/page';

interface PageExplorerProps {
  pageId: string;
}

/**
 * Dedicated for the /page route
 *
 * Work together with a sidebar src/app/[variants]/(main)/page/_layout/Body/index.tsx
 */
const PageExplorer = memo<PageExplorerProps>(({ pageId }) => {
  const updatePageOptimistically = usePageStore((s) => s.updatePageOptimistically);

  // Get document title and emoji from PageStore
  const document = usePageStore(pageSelectors.getDocumentById(pageId));
  const title = document?.title;
  const emoji = document?.metadata?.emoji as string | undefined;

  // Optimistic update handlers for title and emoji
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      updatePageOptimistically(pageId, { title: newTitle });
    },
    [pageId, updatePageOptimistically],
  );

  const handleEmojiChange = useCallback(
    (newEmoji: string | undefined) => {
      updatePageOptimistically(pageId, { emoji: newEmoji });
    },
    [pageId, updatePageOptimistically],
  );

  return (
    <PageEditor
      emoji={emoji}
      key={pageId}
      pageId={pageId}
      title={title}
      onEmojiChange={handleEmojiChange}
      onTitleChange={handleTitleChange}
    />
  );
});

export default PageExplorer;
