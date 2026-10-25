import { Button, Checkbox, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { type FileListItem } from '@/types/files';

import {
  useExplorerSelectionActions,
  useExplorerSelectionSummary,
} from '../hooks/useExplorerSelection';

const styles = stylex.create({
  selectAllHint: {
    backgroundColor: cssVar.colorFillTertiary,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: cssVar.colorTextDescription,
    fontSize: 12,
    insetBlockStart: 53,
    paddingBlock: 8,
    paddingInline: 4,
    position: 'sticky',
    zIndex: 1,
  },
  toolbar: {
    backgroundColor: cssVar.colorBgContainer,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    insetBlockStart: 0,
    paddingBlock: 12,
    paddingInline: 4,
    position: 'sticky',
    zIndex: 1,
  },
});

interface SelectionToolbarProps {
  data: FileListItem[];
  /** Shown after the count, e.g. the source filter chips. */
  extra?: ReactNode;
  hasMore: boolean;
  /** Item count shown while nothing is selected. */
  itemCount: number;
  /** Size of the listed pool; defaults to the folder list's total. */
  total?: number;
}

/**
 * Select-all checkbox, selected count and "select all N" hint above a grid of
 * resources. Selection lives in the ResourceManager store, so the header's
 * batch actions act on whatever is checked here.
 */
const SelectionToolbar = ({
  data,
  extra,
  hasMore,
  itemCount,
  total: poolTotal,
}: SelectionToolbarProps) => {
  const { t } = useTranslation('components');
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
  } = useExplorerSelectionSummary({ data, hasMore, total: poolTotal });

  const isAllResultsSelected = selectAllState === 'all' && total === selectedCount;
  const allSelectedLabelKey = total
    ? isAllResultsSelected
      ? 'FileManager.total.allSelectedCount'
      : 'FileManager.total.selectedCount'
    : 'FileManager.total.allSelectedFallback';

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

  return (
    <>
      <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.toolbar)}>
        <Checkbox
          checked={allSelected}
          disabled={!hasSelectableItems}
          indeterminate={indeterminate}
          onChange={handleSelectAllResults}
        />
        <span>
          {selectedCount > 0 || selectAllState === 'all'
            ? t(
                selectAllState === 'all' ? allSelectedLabelKey : 'FileManager.total.selectedCount',
                { count: selectedCount },
              )
            : t('FileManager.total.fileCount', { count: itemCount })}
        </span>
        <Flexbox flex={1} />
        {extra}
      </Flexbox>
      {showSelectAllHint && (
        <Flexbox
          horizontal
          align={'center'}
          gap={6}
          paddingInline={4}
          wrap={'wrap'}
          {...stylex.props(styles.selectAllHint)}
        >
          <span>
            {t(
              selectAllState === 'all'
                ? allSelectedLabelKey
                : 'FileManager.total.loadedSelectedCount',
              { count: selectedCount },
            )}
          </span>
          {selectAllState !== 'all' && (
            <Button size={'small'} type={'link'} onClick={handleSelectAllResources}>
              {total && total > selectableCount
                ? t('FileManager.total.selectAll', { count: total })
                : t('FileManager.total.selectAllFallback')}
            </Button>
          )}
        </Flexbox>
      )}
    </>
  );
};

export default SelectionToolbar;
