'use client';

import { Accordion, AccordionItem, ContextMenuTrigger, Flexbox, Text } from '@lobehub/ui';
import React, { memo, Suspense, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { type SideBarDrawerHandle } from '@/features/NavPanel/SideBarDrawer';
import PageEmpty from '@/features/PageEmpty';
import { pageSelectors, usePageStore } from '@/store/page';

import Actions from './Actions';
import AllPagesDrawer from './AllPagesDrawer';
import List from './List';
import { useDropdownMenu } from './useDropdownMenu';

export enum GroupKey {
  AllPages = 'all-pages',
}

/**
 * Page list sidebar
 */
const Body = memo(() => {
  const { t } = useTranslation('file');

  // Initialize documents list via SWR
  const useFetchDocuments = usePageStore((s) => s.useFetchDocuments);
  useFetchDocuments();

  const isLoading = usePageStore(pageSelectors.isDocumentsLoading);

  const filteredDocumentsCount = usePageStore(pageSelectors.filteredDocumentsCount);
  const filteredDocuments = usePageStore(pageSelectors.getFilteredDocumentsLimited);
  const searchKeywords = usePageStore((s) => s.searchKeywords);
  const dropdownMenu = useDropdownMenu();
  const drawerRef = useRef<SideBarDrawerHandle>(null);
  const openDrawer = useCallback(() => drawerRef.current?.open(), []);

  return (
    <Flexbox gap={1} paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.AllPages]} gap={2}>
        <AccordionItem
          action={<Actions />}
          itemKey={GroupKey.AllPages}
          paddingBlock={4}
          paddingInline={'8px 4px'}
          headerWrapper={(header) => (
            <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
          )}
          title={
            <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
              {t('pageList.title')}
              {filteredDocumentsCount > 0 && ` ${filteredDocumentsCount}`}
            </Text>
          }
        >
          <Suspense fallback={<SkeletonList />}>
            {isLoading ? (
              <SkeletonList />
            ) : (
              <Flexbox gap={1} paddingBlock={1}>
                {filteredDocuments.length === 0 ? (
                  <PageEmpty search={Boolean(searchKeywords.trim())} />
                ) : (
                  <List onOpenDrawer={openDrawer} />
                )}
              </Flexbox>
            )}
          </Suspense>
        </AccordionItem>
      </Accordion>
      <AllPagesDrawer ref={drawerRef} />
    </Flexbox>
  );
});

export default Body;
