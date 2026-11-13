import { Center, Checkbox, cssVar, cx, Flexbox, Icon } from '@lobehub/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useGlobalStore } from '@/store/global';
import type { FileListItem } from '@/types/files';
import { SortType } from '@/types/files';

import {
  useExplorerSelectionActions,
  useExplorerSelectionSummary,
} from '../hooks/useExplorerSelection';
import ColumnResizeHandle from './ColumnResizeHandle';
import { getListViewMinWidth } from './ListItem/constants';
import ListViewSelectAllHint from './ListViewSelectAllHint';
import { styles } from './styles';

interface ListViewHeaderProps {
  columnWidths: {
    date: number;
    name: number;
    size: number;
    uploader: number;
  };
  data: FileListItem[];
  hasMore: boolean;
  showUploader?: boolean;
  /** Size of the listed pool; defaults to the folder list's total. */
  total?: number;
}

const ListViewHeader = ({
  columnWidths,
  data,
  hasMore,
  showUploader = true,
  total: poolTotal,
}: ListViewHeaderProps) => {
  const { t } = useTranslation(['components', 'file']);
  const updateColumnWidth = useGlobalStore((s) => s.updateResourceManagerColumnWidth);
  const sorter = useResourceManagerStore((s) => s.sorter);
  const sortType = useResourceManagerStore((s) => s.sortType);
  const setSorter = useResourceManagerStore((s) => s.setSorter);
  const setSortType = useResourceManagerStore((s) => s.setSortType);

  const { handleSelectAll, handleSelectAllResources } = useExplorerSelectionActions(data);
  const {
    allSelected,
    hasSelectableItems,
    indeterminate,
    selectAllState,
    selectableCount,
    selectedCount,
    showSelectAllHint,
    total,
  } = useExplorerSelectionSummary({
    data,
    hasMore,
    total: poolTotal,
  });
  const isAllResultsSelected = selectAllState === 'all' && total === selectedCount;
  const selectedLabelKey =
    selectAllState === 'all'
      ? total
        ? isAllResultsSelected
          ? 'FileManager.total.allSelectedCount'
          : 'FileManager.total.selectedCount'
        : 'FileManager.total.allSelectedFallback'
      : 'FileManager.total.selectedCount';
  const handleSelectAllResults = useCallback(
    (checked?: boolean) => {
      if (checked !== false && !hasMore) {
        void handleSelectAllResources();
        return;
      }

      handleSelectAll(checked);
    },
    [handleSelectAll, handleSelectAllResources, hasMore],
  );

  const handleSortClick = useCallback(
    (field: 'name' | 'createdAt' | 'size') => {
      if (sorter === field) {
        setSortType(sortType === SortType.Asc ? SortType.Desc : SortType.Asc);
        return;
      }

      setSorter(field);
      // Names read naturally A-Z; times and sizes are most useful newest/largest first.
      setSortType(field === 'name' ? SortType.Asc : SortType.Desc);
    },
    [setSorter, setSortType, sorter, sortType],
  );
  const handleSortKeyDown = useCallback(
    (event: React.KeyboardEvent, field: 'name' | 'createdAt' | 'size') => {
      if (event.key !== 'Enter' && event.key !== ' ') return;

      event.preventDefault();
      handleSortClick(field);
    },
    [handleSortClick],
  );
  const renderSortIndicator = (field: 'createdAt' | 'name' | 'size') =>
    sorter === field ? (
      <Icon
        color={cssVar.colorPrimary}
        icon={sortType === SortType.Asc ? ArrowUp : ArrowDown}
        size={12}
      />
    ) : null;
  // The name column doubles as the multi-select summary; that text is not a
  // sort control, so sorting is only wired while the column shows its label.
  const showsSelectionText = selectedCount > 0 || selectAllState === 'all';

  return (
    <>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        paddingInline={8}
        style={{
          borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
          fontSize: 12,
          minWidth: getListViewMinWidth(showUploader),
        }}
      >
        <Center height={40} style={{ paddingInline: 4 }}>
          <Checkbox
            checked={allSelected}
            disabled={!hasSelectableItems}
            indeterminate={indeterminate}
            onChange={handleSelectAllResults}
          />
        </Center>
        <Flexbox
          className={cx(styles.headerItem, !showsSelectionText && styles.headerItemSortable)}
          justify={'center'}
          role={showsSelectionText ? undefined : 'button'}
          tabIndex={showsSelectionText ? undefined : 0}
          style={{
            flexShrink: 0,
            maxWidth: columnWidths.name,
            minWidth: columnWidths.name,
            paddingInline: 20,
            paddingInlineEnd: 16,
            position: 'relative',
            width: columnWidths.name,
          }}
          onClick={showsSelectionText ? undefined : () => handleSortClick('name')}
          onKeyDown={showsSelectionText ? undefined : (event) => handleSortKeyDown(event, 'name')}
        >
          {showsSelectionText ? (
            t(selectedLabelKey, {
              count: selectedCount,
              ns: 'components',
            })
          ) : (
            <Flexbox horizontal align={'center'} gap={4}>
              {t('FileManager.title.title')}
              {renderSortIndicator('name')}
            </Flexbox>
          )}
          <ColumnResizeHandle
            column="name"
            currentWidth={columnWidths.name}
            maxWidth={1200}
            minWidth={200}
            onResize={(width) => updateColumnWidth('name', width)}
          />
        </Flexbox>
        <Flexbox
          className={cx(styles.headerItem, styles.headerItemSortable)}
          justify={'center'}
          role={'button'}
          style={{ flexShrink: 0, paddingInlineEnd: 16, position: 'relative' }}
          tabIndex={0}
          width={columnWidths.date}
          onClick={() => handleSortClick('createdAt')}
          onKeyDown={(event) => handleSortKeyDown(event, 'createdAt')}
        >
          <Flexbox horizontal align={'center'} gap={4}>
            {t('FileManager.title.createdAt')}
            {renderSortIndicator('createdAt')}
          </Flexbox>
          <ColumnResizeHandle
            column="date"
            currentWidth={columnWidths.date}
            maxWidth={300}
            minWidth={120}
            onResize={(width) => updateColumnWidth('date', width)}
          />
        </Flexbox>
        {showUploader && (
          <Flexbox
            className={styles.headerItem}
            justify={'center'}
            style={{ flexShrink: 0, paddingInlineEnd: 16, position: 'relative' }}
            width={columnWidths.uploader}
          >
            {t('FileManager.title.uploader')}
            <ColumnResizeHandle
              column="uploader"
              currentWidth={columnWidths.uploader}
              maxWidth={300}
              minWidth={120}
              onResize={(width) => updateColumnWidth('uploader', width)}
            />
          </Flexbox>
        )}
        <Flexbox
          className={cx(styles.headerItem, styles.headerItemSortable)}
          justify={'center'}
          role={'button'}
          style={{ flexShrink: 0, paddingInlineEnd: 16, position: 'relative' }}
          tabIndex={0}
          width={columnWidths.size}
          onClick={() => handleSortClick('size')}
          onKeyDown={(event) => handleSortKeyDown(event, 'size')}
        >
          <Flexbox horizontal align={'center'} gap={4}>
            {t('FileManager.title.size')}
            {renderSortIndicator('size')}
          </Flexbox>
          <ColumnResizeHandle
            column="size"
            currentWidth={columnWidths.size}
            maxWidth={200}
            minWidth={80}
            onResize={(width) => updateColumnWidth('size', width)}
          />
        </Flexbox>
      </Flexbox>
      <ListViewSelectAllHint
        dataLength={selectableCount}
        selectAllState={selectAllState}
        selectedCount={selectedCount}
        showSelectAllHint={showSelectAllHint}
        showUploader={showUploader}
        total={total}
        onSelectAllResources={handleSelectAllResources}
      />
    </>
  );
};

export default ListViewHeader;
