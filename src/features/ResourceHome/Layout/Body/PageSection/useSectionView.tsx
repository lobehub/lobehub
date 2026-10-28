import type { DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { LucideCheck } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import {
  DEFAULT_DOCS_PAGE_SECTION_VIEW,
  type DocsPageSectionKey,
  type DocsPageSectionView,
} from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';

const SORT_OPTIONS: DocsPageSectionView['sortBy'][] = ['updatedAt', 'createdAt', 'title'];
const GROUP_OPTIONS: DocsPageSectionView['groupBy'][] = ['none', 'byTime', 'byType'];
const TYPE_OPTIONS: DocsPageSectionView['type'][] = ['all', 'page', 'artifact'];
const PAGE_SIZE_OPTIONS = [10, 20, 40, 60];

/** One section's persisted list options and their setter. */
export const useSectionView = (scope: DocsPageSectionKey) => {
  const view = useGlobalStore(systemStatusSelectors.docsPageSectionView(scope));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const setView = useCallback(
    (patch: Partial<DocsPageSectionView>) =>
      updateSystemStatus({ docsPageSectionViews: { [scope]: patch } }),
    [scope, updateSystemStatus],
  );

  return [view, setView] as const;
};

/** A type filter hides pages, so the trigger must not read as the whole list. */
export const isSectionNarrowed = (view: DocsPageSectionView) =>
  view.type !== DEFAULT_DOCS_PAGE_SECTION_VIEW.type;

interface SectionViewMenuOptions {
  /** The full list always pages through everything; only the sidebar caps its rows. */
  showPageSize?: boolean;
}

/** Sort / group / type / row-count items for a section's view-options menu. */
export const useSectionViewMenu = (
  scope: DocsPageSectionKey,
  { showPageSize = true }: SectionViewMenuOptions = {},
): (() => DropdownItem[]) => {
  const { t } = useTranslation(['file', 'common']);
  const [view, setView] = useSectionView(scope);

  return useCallback(() => {
    const check = (selected: boolean) => (selected ? <Icon icon={LucideCheck} /> : <div />);

    const items: DropdownItem[] = [
      {
        children: SORT_OPTIONS.map((sortBy) => ({
          icon: check(view.sortBy === sortBy),
          key: `sort-${sortBy}`,
          label: t(`docs.sectionView.sortBy.${sortBy}`),
          onClick: () => setView({ sortBy }),
        })),
        key: 'sort',
        label: t('docs.sectionView.sort'),
        type: 'group',
      },
      { type: 'divider' },
      {
        children: GROUP_OPTIONS.map((groupBy) => ({
          icon: check(view.groupBy === groupBy),
          key: `group-${groupBy}`,
          label: t(`docs.sectionView.groupBy.${groupBy}`),
          onClick: () => setView({ groupBy }),
        })),
        key: 'group',
        label: t('docs.sectionView.group'),
        type: 'group',
      },
      { type: 'divider' },
      {
        children: TYPE_OPTIONS.map((type) => ({
          icon: check(view.type === type),
          key: `type-${type}`,
          label: t(`docs.sectionView.type.${type}`),
          onClick: () => setView({ type }),
        })),
        key: 'type',
        label: t('docs.sectionView.filter'),
        type: 'group',
      },
    ];

    if (showPageSize) {
      items.push(
        { type: 'divider' },
        {
          children: PAGE_SIZE_OPTIONS.map((pageSize) => ({
            icon: check(view.pageSize === pageSize),
            key: `pageSize-${pageSize}`,
            label: t('pageSizeItem', { count: pageSize, ns: 'common' }),
            onClick: () => setView({ pageSize }),
          })),
          key: 'pageSize',
          label: t('docs.sectionView.pageSize'),
          type: 'group',
        },
      );
    }

    return items;
  }, [setView, showPageSize, t, view]);
};
