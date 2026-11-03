'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  ContextMenuTrigger,
  cx,
  Flexbox,
  Spin,
  Text,
} from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import PageEmpty from '@/features/PageEmpty';
import { pageActions, pageSelectors, usePageStore } from '@/store/page';

import Actions from './Actions';
import AllPagesDrawer from './AllPagesDrawer';
import List from './List';
import { useDropdownMenu } from './useDropdownMenu';

export enum GroupKey {
  AllPages = 'all-pages',
}

/**
 * Page list sidebar: one list in both personal and workspace mode. Workspace
 * pages are shared by default; the ones their creator kept private carry a
 * lock on their row instead of living in a separate section.
 */
const Body = memo(() => {
  const { t } = useTranslation('file');

  // Drive the list's replica sync; keep `isValidating` so the accordion header
  // can show a subtle in-flight indicator (mirrors the Private Agent pattern in
  // `home/_layout/Body/Private`).
  // The sync hook only returns flags — the rows live in the store. Use the list
  // entry itself as the settled signal: it is `undefined` until IndexedDB
  // hydration or the first server page lands, so a failed load surfaces error +
  // Retry instead of a permanent skeleton.
  const { error, isValidating, revalidate } = pageActions.useFetchDocuments();
  const isPageListInit = usePageStore(pageSelectors.isPageListInit);

  const filteredDocumentsCount = usePageStore(pageSelectors.filteredDocumentsCount);
  const searchKeywords = usePageStore((s) => s.searchKeywords);
  const dropdownMenu = useDropdownMenu();
  const allPagesDrawerOpen = usePageStore((s) => s.allPagesDrawerOpen);

  const searchActive = Boolean(searchKeywords.trim());

  return (
    <Flexbox gap={1} paddingInline={4}>
      <AccordionRoot
        defaultValue={[GroupKey.AllPages]}
        indicatorPlacement="inline"
        style={{ gap: 2 }}
      >
        <AccordionItem value={GroupKey.AllPages}>
          <ContextMenuTrigger items={dropdownMenu}>
            <AccordionHeader>
              <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
                <Flexbox horizontal align="center" gap={4}>
                  <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                    {t('pageList.title')}
                    {filteredDocumentsCount > 0 && ` ${filteredDocumentsCount}`}
                  </Text>
                  {isValidating && <Spin size="small" variant="network" />}
                </Flexbox>
              </AccordionTrigger>
              <Flexbox
                horizontal
                align="center"
                gap={2}
                className={cx(
                  'accordion-action',
                  accordionStyles.action,
                  accordionStyles.actionBorderless,
                )}
              >
                <Actions />
              </Flexbox>
            </AccordionHeader>
          </ContextMenuTrigger>
          <AccordionPanel>
            <AsyncBoundary
              data={isPageListInit || undefined}
              error={error}
              errorVariant={'inline'}
              isLoading={!isPageListInit && !error}
              loading={<SkeletonList />}
              onRetry={() => revalidate()}
            >
              <Flexbox gap={1} paddingBlock={1}>
                {filteredDocumentsCount === 0 ? <PageEmpty search={searchActive} /> : <List />}
              </Flexbox>
            </AsyncBoundary>
          </AccordionPanel>
        </AccordionItem>
      </AccordionRoot>
      <AllPagesDrawer open={allPagesDrawerOpen} onClose={pageActions.closeAllPagesDrawer} />
    </Flexbox>
  );
});

export default Body;
