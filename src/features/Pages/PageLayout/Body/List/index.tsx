'use client';

import { Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { pageSelectors, usePageStore } from '@/store/page';

import Item from './Item';

interface PageListProps {
  /**
   * Bucket to render when the sidebar is in workspace mode. Omitting the prop
   * renders the historical unified "All pages" list (personal mode).
   */
  visibility?: 'private' | 'workspace';
}

/**
 * Sidebar page list. In workspace mode the same component drives each of the
 * "Private" / "Workspace" accordions; personal mode collapses to a single
 * unified list.
 */
const PageList = memo<PageListProps>(({ visibility }) => {
  const { t } = useTranslation(['file', 'common']);

  const [filteredDocuments, hasMore, isLoadingMore, openAllPagesDrawer] = usePageStore((s) => {
    let docs;
    let more;
    if (visibility === 'private') {
      docs = pageSelectors.getPrivateFilteredDocumentsLimited(s);
      more = pageSelectors.hasMorePrivateFilteredDocuments(s);
    } else if (visibility === 'workspace') {
      docs = pageSelectors.getWorkspaceFilteredDocumentsLimited(s);
      more = pageSelectors.hasMoreWorkspaceFilteredDocuments(s);
    } else {
      docs = pageSelectors.getFilteredDocumentsLimited(s);
      more = pageSelectors.hasMoreFilteredDocuments(s);
    }
    return [docs, more, pageSelectors.isLoadingMoreDocuments(s), s.openAllPagesDrawer] as const;
  });

  return (
    <Flexbox gap={1}>
      {filteredDocuments.map((doc) => (
        <Item key={doc.id} pageId={doc.id} />
      ))}
      {isLoadingMore && <SkeletonList rows={3} />}
      {hasMore && !isLoadingMore && (
        <NavItem
          icon={MoreHorizontal}
          title={t('more', { ns: 'common' })}
          onClick={openAllPagesDrawer}
        />
      )}
    </Flexbox>
  );
});

export default PageList;
