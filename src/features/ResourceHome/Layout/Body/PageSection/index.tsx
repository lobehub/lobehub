'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  cx,
  DropdownMenu,
  Flexbox,
  Spin,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { ListFilter, MoreHorizontal, PanelRightOpenIcon, SquarePenIcon } from 'lucide-react';
import { Fragment, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { usePermission } from '@/hooks/usePermission';
import { pageActions, pageSelectors, usePageStore } from '@/store/page';
import type { PageSectionScope } from '@/store/page/projection';

import { groupPageRows } from './group';
import GroupTitle from './GroupTitle';
import PageRow from './PageRow';
import { buildPageTree } from './tree';
import { useOpenPage } from './useOpenPage';
import { isSectionNarrowed, useSectionView, useSectionViewMenu } from './useSectionView';

interface PageSectionProps {
  itemKey: string;
  scope: PageSectionScope;
}

/**
 * A sidebar section of standalone pages (pages filed into a library open from
 * the library). `mine` is the caller's own pages and offers "new page";
 * `shared` is what other workspace members published.
 */
const PageSection = memo<PageSectionProps>(({ itemKey, scope }) => {
  const { t } = useTranslation('file');
  const [creating, setCreating] = useState(false);
  const { allowed: canCreate, reason } = usePermission('create_content');
  const [view] = useSectionView(scope);
  const viewMenu = useSectionViewMenu(scope);

  const { error, isValidating, revalidate } = pageActions.useFetchPageSection({
    limit: view.pageSize,
    scope,
    sortBy: view.sortBy,
    type: view.type,
  });
  const docs = usePageStore(pageSelectors.pageSection(scope));

  const groups = useMemo(
    () => (docs ? groupPageRows(buildPageTree(docs.slice(0, view.pageSize)), view) : undefined),
    [docs, view],
  );
  const hasMore = (docs?.length ?? 0) > view.pageSize;
  const openFullList = () => pageActions.openSectionFullList(scope);

  // Pages open over the Docs home, keeping the user in Docs.
  const { openPage, openPageId } = useOpenPage();

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      // `createPage` (not `createNewPage`) so the Pages module's own navigation
      // never takes the user out of Docs.
      const page = await pageActions.createPage({ title: t('pageList.untitled') });
      openPage(page.id);
      void pageActions.refreshDocuments();
    } catch (error) {
      console.error('[PageSection] failed to create a page:', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setCreating(false);
    }
  };

  const title = t(scope === 'mine' ? 'docs.myDocs.title' : 'docs.shared.title');

  const createButton = (
    <ActionIcon
      disabled={!canCreate}
      icon={SquarePenIcon}
      loading={creating}
      size={'small'}
      title={canCreate ? t('header.newPageButton') : undefined}
      onClick={handleCreate}
    />
  );

  const narrowed = isSectionNarrowed(view);
  const actionsClassName = cx(
    'accordion-action',
    accordionStyles.action,
    accordionStyles.actionBorderless,
  );

  return (
    <AccordionItem value={itemKey}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Flexbox horizontal align={'center'} gap={4}>
            <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
              {title}
            </Text>
            {isValidating && !!groups?.length && <Spin size={'small'} variant={'network'} />}
          </Flexbox>
        </AccordionTrigger>
        {/* A type filter hides pages: keep its trigger on screen, not hover-only. */}
        <Flexbox
          horizontal
          align={'center'}
          className={actionsClassName}
          gap={2}
          style={narrowed ? { opacity: 1 } : undefined}
        >
          <DropdownMenu items={viewMenu}>
            <ActionIcon
              active={narrowed}
              icon={ListFilter}
              size={'small'}
              title={t('docs.sectionView.title')}
            />
          </DropdownMenu>
          <ActionIcon
            aria-label={t('docs.sectionView.openFullList')}
            icon={PanelRightOpenIcon}
            size={'small'}
            title={t('docs.sectionView.openFullList')}
            onClick={openFullList}
          />
          {scope === 'mine' &&
            (canCreate ? createButton : <Tooltip title={reason}>{createButton}</Tooltip>)}
        </Flexbox>
      </AccordionHeader>
      <AccordionPanel>
        <AsyncBoundary
          data={groups}
          error={error}
          errorVariant={'inline'}
          isEmpty={groups?.length === 0}
          isLoading={groups === undefined && !error}
          loading={<SkeletonList paddingInline={4} rows={3} />}
          empty={
            narrowed ? (
              <Text fontSize={12} style={{ paddingInline: 12 }} type={'secondary'}>
                {t('docs.sectionView.emptyFiltered')}
              </Text>
            ) : scope === 'mine' ? (
              <EmptyNavItem
                disabled={!canCreate}
                title={t('docs.myDocs.empty')}
                onClick={handleCreate}
              />
            ) : (
              <Text fontSize={12} style={{ paddingInline: 12 }} type={'secondary'}>
                {t('docs.shared.empty')}
              </Text>
            )
          }
          onRetry={() => revalidate()}
        >
          <Flexbox gap={1} paddingInline={4}>
            {groups?.map(({ id, rows }) => (
              <Fragment key={id}>
                {id !== 'all' && <GroupTitle id={id} />}
                {rows.map(({ depth, doc }) => (
                  <PageRow
                    depth={depth}
                    doc={doc}
                    isOpen={openPageId === doc.id}
                    key={doc.id}
                    onOpen={openPage}
                  />
                ))}
              </Fragment>
            ))}
            {hasMore && (
              <NavItem
                icon={MoreHorizontal}
                title={t('docs.viewAllPages')}
                // Opens the section's paged full list rather than the Docs
                // home, whose mixed recent list is capped and mixes files in —
                // an older page pushed out of both lists would be unreachable.
                onClick={openFullList}
              />
            )}
          </Flexbox>
        </AsyncBoundary>
      </AccordionPanel>
    </AccordionItem>
  );
});

PageSection.displayName = 'PageSection';

export default PageSection;
