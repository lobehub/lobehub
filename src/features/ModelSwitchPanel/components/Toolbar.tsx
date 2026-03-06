import { Flexbox, SearchBar, stopPropagation } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '../styles';

interface ToolbarProps {
  onSearchKeywordChange: (keyword: string) => void;
  searchKeyword: string;
}

export const Toolbar = memo<ToolbarProps>(({ searchKeyword, onSearchKeywordChange }) => {
  const { t } = useTranslation('components');

  return (
    <Flexbox
      horizontal
      align="center"
      className={styles.toolbar}
      gap={4}
      paddingBlock={8}
      paddingInline={8}
    >
      <SearchBar
        allowClear
        placeholder={t('ModelSwitchPanel.searchPlaceholder')}
        size="small"
        style={{ flex: 1 }}
        value={searchKeyword}
        variant="borderless"
        onChange={(e) => onSearchKeywordChange(e.target.value)}
        onKeyDown={stopPropagation}
      />
    </Flexbox>
  );
});

Toolbar.displayName = 'Toolbar';
