'use client';

import {
  Accordion,
  AccordionItem,
  Block,
  Center,
  ContextMenuTrigger,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncBoundary from '@/components/AsyncBoundary';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import PageEmpty from '@/features/PageEmpty';
import { usePermission } from '@/hooks/usePermission';
import { pageSelectors, usePageStore } from '@/store/page';

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

  // Initialize documents list via SWR; keep `isValidating` so the accordion
  // header can show a subtle in-flight indicator (mirrors the Private Agent
  // pattern in `home/_layout/Body/Private`).
  const useFetchDocuments = usePageStore((s) => s.useFetchDocuments);
  // Use the SWR result as the settled signal: `data` is `undefined` until the
  // first fetch succeeds, so a failed load surfaces error + Retry instead of a
  // permanent skeleton. The store's `documents` field can't be the signal — it
  // initializes to `[]` (a settled-looking empty), so a failed fetch would fall
  // through to the "no pages" empty rather than the error (LOBE-11127).
  const { data, error, isLoading, isValidating, mutate } = useFetchDocuments();

  const filteredDocumentsCount = usePageStore(pageSelectors.filteredDocumentsCount);
  const privateCount = usePageStore(pageSelectors.privateFilteredDocumentsCount);
  const workspaceCount = usePageStore(pageSelectors.workspaceFilteredDocumentsCount);
  const searchKeywords = usePageStore((s) => s.searchKeywords);
  const dropdownMenu = useDropdownMenu();
  const [allPagesDrawerOpen, closeAllPagesDrawer] = usePageStore((s) => [
    s.allPagesDrawerOpen,
    s.closeAllPagesDrawer,
  ]);

  const activeWorkspaceId = useActiveWorkspaceId();
  const searchActive = Boolean(searchKeywords.trim());

  // Empty-bucket call-to-action: a single "New Page" row that creates directly
  // into the right visibility. Mirrors the Home sidebar's "创建助理" affordance
  // — the bucket is empty but still actionable.
  const createNewPage = usePageStore((s) => s.createNewPage);
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
      onClick={() => canCreate && createNewPage(untitledLabel, visibility)}
    >
      <Center flex={'none'} height={28} width={28}>
        <Icon icon={PlusIcon} size={'small'} />
      </Center>
      <Text style={{ flex: 1 }} type={'secondary'}>
        {newPageLabel}
      </Text>
    </Block>
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {activeWorkspaceId ? (
        <Accordion defaultExpandedKeys={[GroupKey.PrivatePages, GroupKey.WorkspacePages]} gap={2}>
          <AccordionItem
            itemKey={GroupKey.PrivatePages}
            paddingBlock={4}
            paddingInline={'8px 4px'}
            action={
              <Flexbox horizontal align="center" gap={2}>
                <Actions />
                <AddButton compact visibility="private" />
              </Flexbox>
            }
            headerWrapper={(header) => (
              <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
            )}
            title={
              <Flexbox horizontal align="center" gap={4}>
                <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                  {t('pageList.privateTitle')}
                  {privateCount > 0 && ` ${privateCount}`}
                </Text>
                {isValidating && <NeuralNetworkLoading size={14} />}
              </Flexbox>
            }
          >
            <AsyncBoundary
              data={data}
              error={error}
              errorVariant={'inline'}
              isLoading={isLoading}
              loading={<SkeletonList />}
              onRetry={() => mutate()}
            >
              <Flexbox gap={1} paddingBlock={1}>
                {privateCount === 0 ? (
                  searchActive ? (
                    <Text
                      align="center"
                      fontSize={12}
                      style={{ paddingBlock: 12, paddingInline: 8 }}
                      type={'secondary'}
                    >
                      {t('pageList.noResults')}
                    </Text>
                  ) : (
                    renderEmptyCreate('private')
                  )
                ) : (
                  <List visibility="private" />
                )}
              </Flexbox>
            </AsyncBoundary>
          </AccordionItem>
          <AccordionItem
            action={<AddButton compact visibility="public" />}
            itemKey={GroupKey.WorkspacePages}
            paddingBlock={4}
            paddingInline={'8px 4px'}
            headerWrapper={(header) => (
              <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
            )}
            title={
              <Flexbox horizontal align="center" gap={4}>
                <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                  {t('pageList.workspaceTitle')}
                  {workspaceCount > 0 && ` ${workspaceCount}`}
                </Text>
                {isValidating && <NeuralNetworkLoading size={14} />}
              </Flexbox>
            }
          >
            <AsyncBoundary
              data={data}
              error={error}
              errorVariant={'inline'}
              isLoading={isLoading}
              loading={<SkeletonList />}
              onRetry={() => mutate()}
            >
              <Flexbox gap={1} paddingBlock={1}>
                {workspaceCount === 0 ? (
                  searchActive ? (
                    <Text
                      align="center"
                      fontSize={12}
                      style={{ paddingBlock: 12, paddingInline: 8 }}
                      type={'secondary'}
                    >
                      {t('pageList.noResults')}
                    </Text>
                  ) : (
                    renderEmptyCreate('public')
                  )
                ) : (
                  <List visibility="workspace" />
                )}
              </Flexbox>
            </AsyncBoundary>
          </AccordionItem>
        </Accordion>
      ) : (
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
              <Flexbox horizontal align="center" gap={4}>
                <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                  {t('pageList.title')}
                  {filteredDocumentsCount > 0 && ` ${filteredDocumentsCount}`}
                </Text>
                {isValidating && <NeuralNetworkLoading size={14} />}
              </Flexbox>
            }
          >
            <AsyncBoundary
              data={data}
              error={error}
              errorVariant={'inline'}
              isLoading={isLoading}
              loading={<SkeletonList />}
              onRetry={() => mutate()}
            >
              <Flexbox gap={1} paddingBlock={1}>
                {filteredDocumentsCount === 0 ? <PageEmpty search={searchActive} /> : <List />}
              </Flexbox>
            </AsyncBoundary>
          </AccordionItem>
        </Accordion>
      )}
      <AllPagesDrawer open={allPagesDrawerOpen} onClose={closeAllPagesDrawer} />
    </Flexbox>
  );
});

export default Body;
