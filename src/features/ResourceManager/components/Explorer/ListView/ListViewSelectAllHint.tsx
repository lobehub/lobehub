import { Button, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { SelectAllState } from '@/routes/(main)/resource/features/store/initialState';

import { styles } from './styles';

interface ListViewSelectAllHintProps {
  dataLength: number;
  onSelectAllResources: () => void;
  selectAllState: SelectAllState;
  selectedCount: number;
  showSelectAllHint: boolean;
  total?: number;
}

const ListViewSelectAllHint = ({
  dataLength,
  onSelectAllResources,
  selectedCount,
  selectAllState,
  showSelectAllHint,
  total,
}: ListViewSelectAllHintProps) => {
  const { t } = useTranslation('components');
  const isAllResultsSelected = selectAllState === 'all' && total === selectedCount;

  if (!showSelectAllHint) return null;

  return (
    <Flexbox horizontal align={'center'} className={styles.selectAllHint} gap={6} wrap={'wrap'}>
      <span>
        {t(
          selectAllState === 'all'
            ? total
              ? isAllResultsSelected
                ? 'FileManager.total.allSelectedCount'
                : 'FileManager.total.selectedCount'
              : 'FileManager.total.allSelectedFallback'
            : 'FileManager.total.loadedSelectedCount',
          {
            count: selectedCount,
          },
        )}
      </span>
      {selectAllState !== 'all' && (
        <Button size={'small'} type={'link'} onClick={onSelectAllResources}>
          {total && total > dataLength
            ? t('FileManager.total.selectAll', {
                count: total,
              })
            : t('FileManager.total.selectAllFallback')}
        </Button>
      )}
    </Flexbox>
  );
};

export default ListViewSelectAllHint;
