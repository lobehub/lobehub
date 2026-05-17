'use client';

import { Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { pageSelectors, usePageStore } from '@/store/page';

import Item from './Item';

interface PageListProps {
  onOpenDrawer: () => void;
}

/**
 * Show pages filtered by library
 */
const PageList = ({ onOpenDrawer }: PageListProps) => {
  const { t } = useTranslation(['file', 'common']);

  const [filteredDocuments, hasMore, isLoadingMore] = usePageStore((s) => [
    pageSelectors.getFilteredDocumentsLimited(s),
    pageSelectors.hasMoreFilteredDocuments(s),
    pageSelectors.isLoadingMoreDocuments(s),
  ]);

  return (
    <Flexbox gap={1}>
      {filteredDocuments.map((doc) => (
        <Item key={doc.id} pageId={doc.id} />
      ))}
      {isLoadingMore && <SkeletonList rows={3} />}
      {hasMore && !isLoadingMore && (
        <NavItem icon={MoreHorizontal} title={t('more', { ns: 'common' })} onClick={onOpenDrawer} />
      )}
    </Flexbox>
  );
};

export default PageList;
