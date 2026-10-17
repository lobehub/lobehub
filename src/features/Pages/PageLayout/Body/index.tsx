'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  Block,
  Center,
  ContextMenuTrigger,
  cx,
  Flexbox,
  Icon,
  Spin,
  Text,
} from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import PageEmpty from '@/features/PageEmpty';
import { usePermission } from '@/hooks/usePermission';
import { pageActions, pageSelectors, usePageStore } from '@/store/page';

import AddButton from '../Header/AddButton';
import Actions from './Actions';
import AllPagesDrawer from './AllPagesDrawer';
import List from './List';
import { useDropdownMenu } from './useDropdownMenu';

export enum GroupKey {
  AllPages = 'all-pages',
  PrivatePages = 'private-pages',
  WorkspacePages = 'workspace-pages',
}

/**
 * Page list sidebar.
 *
 * Workspace mode splits documents into two virtual roots — "Private" (only the
 * creator sees them) and "Workspace" (shared with every member) — mirroring
 * the Home sidebar's Private / Agent accordions. Personal mode collapses to
 * the historical single accordion since `visibility` is meaningless there.
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
  const privateCount = usePageStore(pageSelectors.privateFilteredDocumentsCount);
  const workspaceCount = usePageStore(pageSelectors.workspaceFilteredDocumentsCount);
  const searchKeywords = usePageStore((s) => s.searchKeywords);
  const dropdownMenu = useDropdownMenu();
  const allPagesDrawerOpen = usePageStore((s) => s.allPagesDrawerOpen);

  const activeWorkspaceId = useActiveWorkspaceId();
  const searchActive = Boolean(searchKeywords.trim());

  // Empty-bucket call-to-action: a single "New Page" row that creates directly
  // into the right visibility. Mirrors the Home sidebar's "创建助理" affordance
  // — the bucket is empty but still actionable.
  const { allowed: canCreate } = usePermission('create_content');
  const untitledLabel = t('pageList.untitled');
  const newPageLabel = t('addPage');

  const renderEmptyCreate = (visibility: 'private' | 'public') => (
    <Block
      horizontal
      align={'center'}
      clickable={canCreate}
      gap={8}
      height={36}
      paddingInline={4}
      style={canCreate ? { height: 36 } : { cursor: 'not-allowed', height: 36, opacity: 0.5 }}
      variant={'borderless'}
      onClick={() => canCreate && pageActions.createNewPage(untitledLabel, visibility)}
    >
      <Center flex={'none'} height={28} width={28}>
        <Icon icon={PlusIcon} size={'small'} />
      </Center>
      <Text style={{ flex: 1 }} type={'secondary'}>
        {newPageLabel}
      </Text>
    </Block>
  );

  const renderNoResults = () => (
    <Text
      align="center"
      fontSize={12}
      style={{ paddingBlock: 12, paddingInline: 8 }}
      type={'secondary'}
    >
      {t('pageList.noResults')}
    </Text>
  );

  // One accordion section: the header opens the page-list context menu, the
  // action row reveals on hover, and the panel waits on the shared SWR load.
  const renderSection = (section: {
    action: ReactNode;
    children: ReactNode;
    count: number;
    key: GroupKey;
    title: string;
  }) => (
    <AccordionItem key={section.key} value={section.key}>
      <ContextMenuTrigger items={dropdownMenu}>
        <AccordionHeader>
          <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
            <Flexbox horizontal align="center" gap={4}>
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {section.title}
                {section.count > 0 && ` ${section.count}`}
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
            {section.action}
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
            {section.children}
          </Flexbox>
        </AsyncBoundary>
      </AccordionPanel>
    </AccordionItem>
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {activeWorkspaceId ? (
        <AccordionRoot
          defaultValue={[GroupKey.PrivatePages, GroupKey.WorkspacePages]}
          indicatorPlacement="inline"
          style={{ gap: 2 }}
        >
          {renderSection({
            action: (
              <>
                <Actions />
                <AddButton compact visibility="private" />
              </>
            ),
            children:
              privateCount === 0 ? (
                searchActive ? (
                  renderNoResults()
                ) : (
                  renderEmptyCreate('private')
                )
              ) : (
                <List visibility="private" />
              ),
            count: privateCount,
            key: GroupKey.PrivatePages,
            title: t('pageList.privateTitle'),
          })}
          {renderSection({
            action: <AddButton compact visibility="public" />,
            children:
              workspaceCount === 0 ? (
                searchActive ? (
                  renderNoResults()
                ) : (
                  renderEmptyCreate('public')
                )
              ) : (
                <List visibility="workspace" />
              ),
            count: workspaceCount,
            key: GroupKey.WorkspacePages,
            title: t('pageList.workspaceTitle'),
          })}
        </AccordionRoot>
      ) : (
        <AccordionRoot
          defaultValue={[GroupKey.AllPages]}
          indicatorPlacement="inline"
          style={{ gap: 2 }}
        >
          {renderSection({
            action: <Actions />,
            children: filteredDocumentsCount === 0 ? <PageEmpty search={searchActive} /> : <List />,
            count: filteredDocumentsCount,
            key: GroupKey.AllPages,
            title: t('pageList.title'),
          })}
        </AccordionRoot>
      )}
      <AllPagesDrawer open={allPagesDrawerOpen} onClose={pageActions.closeAllPagesDrawer} />
    </Flexbox>
  );
});

export default Body;
