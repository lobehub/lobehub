'use client';

import { Block, Center, ContextMenuTrigger, Flexbox, Icon } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  Text,
} from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
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
  // through to the "no pages" empty rather than the error.
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
              {isValidating && <NeuralNetworkLoading size={14} />}
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
          data={data}
          error={error}
          errorVariant={'inline'}
          isLoading={isLoading}
          loading={<SkeletonList />}
          onRetry={() => mutate()}
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
      <AllPagesDrawer open={allPagesDrawerOpen} onClose={closeAllPagesDrawer} />
    </Flexbox>
  );
});

export default Body;
