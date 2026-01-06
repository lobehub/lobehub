'use client';

import { Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { documentSelectors, useFileStore } from '@/store/file';

import Item from './Item';

/**
 * Show pages filtered by library
 */
const PageList = () => {
  const { t } = useTranslation(['file', 'common']);

  const [filteredPages, hasMore, isLoadingMore, openAllPagesDrawer] = useFileStore((s) => [
    documentSelectors.getFilteredPagesLimited(s),
    documentSelectors.hasMoreFilteredPages(s),
    documentSelectors.isLoadingMoreDocuments(s),
    s.openAllPagesDrawer,
  ]);

  return (
    <Flexbox gap={1}>
      {filteredPages.map((page) => (
        <Item key={page.id} pageId={page.id} />
      ))}
      {isLoadingMore && <SkeletonList rows={3} />}
      {hasMore && !isLoadingMore && (
        <NavItem
          icon={MoreHorizontal}
          onClick={openAllPagesDrawer}
          title={t('more', { ns: 'common' })}
        />
      )}
    </Flexbox>
  );
};

export default PageList;
