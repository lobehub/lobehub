import { Center, Checkbox, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import type { FileListItem } from '@/types/files';

import {
  useExplorerSelectionActions,
  useExplorerSelectionSummary,
} from '../hooks/useExplorerSelection';
import ColumnResizeHandle from './ColumnResizeHandle';
import ListViewSelectAllHint from './ListViewSelectAllHint';
import { styles } from './styles';

interface ListViewHeaderProps {
  columnWidths: {
    date: number;
    name: number;
    size: number;
  };
  data: FileListItem[];
  hasMore: boolean;
}

const ListViewHeader = ({ columnWidths, data, hasMore }: ListViewHeaderProps) => {
  const { t } = useTranslation(['components', 'file']);
  const updateColumnWidth = useGlobalStore((s) => s.updateResourceManagerColumnWidth);
  const { handleSelectAll, handleSelectAllResources } = useExplorerSelectionActions(data);
  const { allSelected, indeterminate, selectAllState, selectedCount, showSelectAllHint, total } =
    useExplorerSelectionSummary({
      data,
      hasMore,
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
        }}
      >
        <Center height={40} style={{ paddingInline: 4 }}>
          <Checkbox
            checked={allSelected}
            indeterminate={indeterminate}
            onChange={handleSelectAll}
          />
        </Center>
        <Flexbox
          className={styles.headerItem}
          justify={'center'}
          style={{
            flexShrink: 0,
            maxWidth: columnWidths.name,
            minWidth: columnWidths.name,
            paddingInline: 20,
            paddingInlineEnd: 16,
            position: 'relative',
            width: columnWidths.name,
          }}
        >
          {selectedCount > 0 || selectAllState === 'all'
            ? t(selectedLabelKey, {
                count: selectedCount,
                ns: 'components',
              })
            : t('FileManager.title.title')}
          <ColumnResizeHandle
            column="name"
            currentWidth={columnWidths.name}
            maxWidth={1200}
            minWidth={200}
            onResize={(width) => updateColumnWidth('name', width)}
          />
        </Flexbox>
        <Flexbox
          className={styles.headerItem}
          justify={'center'}
          style={{ flexShrink: 0, paddingInlineEnd: 16, position: 'relative' }}
          width={columnWidths.date}
        >
          {t('FileManager.title.createdAt')}
          <ColumnResizeHandle
            column="date"
            currentWidth={columnWidths.date}
            maxWidth={300}
            minWidth={120}
            onResize={(width) => updateColumnWidth('date', width)}
          />
        </Flexbox>
        <Flexbox
          className={styles.headerItem}
          justify={'center'}
          style={{ flexShrink: 0, paddingInlineEnd: 16, position: 'relative' }}
          width={columnWidths.size}
        >
          {t('FileManager.title.size')}
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
        dataLength={data.length}
        selectAllState={selectAllState}
        selectedCount={selectedCount}
        showSelectAllHint={showSelectAllHint}
        total={total}
        onSelectAllResources={handleSelectAllResources}
      />
    </>
  );
};

export default ListViewHeader;
