import { Flexbox, Icon, SearchBar, Segmented } from '@lobehub/ui';
import { ProviderIcon } from '@lobehub/ui/icons';
import { Brain } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '../styles';
import type { GroupMode } from '../types';

interface ToolbarProps {
  groupMode: GroupMode;
  onGroupModeChange: (mode: GroupMode) => void;
  onSearchKeywordChange: (keyword: string) => void;
  searchKeyword: string;
}

export const Toolbar = memo<ToolbarProps>(
  ({ groupMode, onGroupModeChange, searchKeyword, onSearchKeywordChange }) => {
    const { t } = useTranslation('components');

    return (
      <Flexbox className={styles.toolbar} gap={4} horizontal paddingBlock={8} paddingInline={8}>
        <SearchBar
          allowClear
          onChange={(e) => onSearchKeywordChange(e.target.value)}
          placeholder={t('ModelSwitchPanel.searchPlaceholder')}
          size="small"
          style={{ flex: 1 }}
          value={searchKeyword}
          variant="borderless"
        />
        <Segmented
          onChange={(value) => onGroupModeChange(value as GroupMode)}
          options={[
            {
              icon: <Icon icon={Brain} />,
              title: t('ModelSwitchPanel.byModel'),
              value: 'byModel',
            },
            {
              icon: <Icon icon={ProviderIcon} />,
              title: t('ModelSwitchPanel.byProvider'),
              value: 'byProvider',
            },
          ]}
          size="small"
          value={groupMode}
        />
      </Flexbox>
    );
  },
);

Toolbar.displayName = 'Toolbar';
