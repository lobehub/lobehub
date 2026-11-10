'use client';

import { ActionIcon, DropdownMenu, Flexbox, Text } from '@lobehub/ui';
import { ListFilter } from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { VList, type VListHandle } from 'virtua';

import AsyncBoundary from '@/components/AsyncBoundary';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import SideBarDrawer from '@/features/NavPanel/SideBarDrawer';
import { pageActions, pageSelectors, usePageStore } from '@/store/page';
import type { PageSectionScope } from '@/store/page/projection';

import { groupPageRows } from './group';
import GroupTitle from './GroupTitle';
import PageRow from './PageRow';
import { buildPageTree } from './tree';
import { useOpenPage } from './useOpenPage';
import { isSectionNarrowed, useSectionView, useSectionViewMenu } from './useSectionView';

/** Load the next page once the viewport bottom is this many rows from the end. */
const LOAD_MORE_THRESHOLD = 8;

const FullListContent = memo<{ scope: PageSectionScope }>(({ scope }) => {
  const { t } = useTranslation('file');
  const [view] = useSectionView(scope);
  const { openPage, openPageId } = useOpenPage();
  const virtuaRef = useRef<VListHandle>(null);

  const params = useMemo(
    () => ({ scope, sortBy: view.sortBy, type: view.type }),
    [scope, view.sortBy, view.type],
  );
  const { error, revalidate } = pageActions.useFetchPageSectionList(params);
  const list = usePageStore(pageSelectors.pageSectionList(scope));

  // Group titles and rows share one virtual list.
  const entries = useMemo(() => {
    if (!list) return undefined;
    return groupPageRows(buildPageTree(list.items), view).flatMap(({ id, rows }) => [
      ...(id === 'all' ? [] : [{ id, kind: 'title' as const }]),
      ...rows.map((row) => ({ ...row, kind: 'row' as const })),
    ]);
  }, [list, view]);

  const hasMore = !!list?.hasMore;
  const isLoadingMore = !!list?.isLoadingMore;
  const count = entries?.length ?? 0;

  const handleScroll = useCallback(() => {
    const ref = virtuaRef.current;
    if (!ref || !hasMore || isLoadingMore) return;

    const bottomIndex = ref.findItemIndex(ref.scrollOffset + ref.viewportSize);
    if (bottomIndex + LOAD_MORE_THRESHOLD >= count) {
      void pageActions.loadMorePageSectionList(params);
    }
  }, [count, hasMore, isLoadingMore, params]);

  return (
    <AsyncBoundary
      data={entries}
      error={error}
      errorVariant={'inline'}
      isEmpty={entries?.length === 0}
      isLoading={entries === undefined && !error}
      loading={<SkeletonList paddingInline={8} rows={6} />}
      empty={
        <Text fontSize={12} style={{ padding: 12 }} type={'secondary'}>
          {t(
            isSectionNarrowed(view)
              ? 'docs.sectionView.emptyFiltered'
              : scope === 'mine'
                ? 'docs.myDocs.empty'
                : 'docs.shared.empty',
          )}
        </Text>
      }
      onRetry={() => revalidate()}
    >
      <VList
        bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
        ref={virtuaRef}
        style={{ height: '100%' }}
        onScroll={handleScroll}
      >
        {entries?.map((entry) =>
          entry.kind === 'title' ? (
            <Flexbox key={`title-${entry.id}`} paddingInline={4}>
              <GroupTitle id={entry.id} />
            </Flexbox>
          ) : (
            <Flexbox key={entry.doc.id} paddingBlock={1} paddingInline={4}>
              <PageRow
                depth={entry.depth}
                doc={entry.doc}
                isOpen={openPageId === entry.doc.id}
                onOpen={openPage}
              />
            </Flexbox>
          ),
        )}
        {isLoadingMore && <SkeletonList paddingInline={8} rows={3} />}
      </VList>
    </AsyncBoundary>
  );
});

FullListContent.displayName = 'PageSectionFullListContent';

interface FullListDrawerProps {
  onClose: () => void;
  open: boolean;
  scope: PageSectionScope;
  title: string;
}

/**
 * Every page of one section, opened beside the sidebar. The section itself
 * only shows its first rows; this panel pages through the rest with the same
 * sort, grouping and type filter.
 */
const FullListDrawer = memo<FullListDrawerProps>(({ open, onClose, scope, title }) => {
  const { t } = useTranslation('file');
  const [view] = useSectionView(scope);
  const viewMenu = useSectionViewMenu(scope, { showPageSize: false });

  return (
    <SideBarDrawer
      open={open}
      title={title}
      action={
        <DropdownMenu items={viewMenu}>
          <ActionIcon
            active={isSectionNarrowed(view)}
            icon={ListFilter}
            size={'small'}
            title={t('docs.sectionView.title')}
          />
        </DropdownMenu>
      }
      onClose={onClose}
    >
      {/* Mounted only while open, so a closed panel never pages the list. */}
      {open && <FullListContent scope={scope} />}
    </SideBarDrawer>
  );
});

FullListDrawer.displayName = 'PageSectionFullListDrawer';

export default FullListDrawer;
