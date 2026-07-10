import { Flexbox, Icon, SearchBar, stopPropagation, Tooltip } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { ProviderIcon } from '@lobehub/ui/icons';
import { Brain } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '../styles';
import { type GroupMode } from '../types';

interface ToolbarProps {
  groupMode?: GroupMode;
  onGroupModeChange?: (mode: GroupMode) => void;
  onSearchKeywordChange: (keyword: string) => void;
  searchKeyword: string;
  showGroupModeSwitch?: boolean;
}

export const Toolbar = memo<ToolbarProps>(
  ({ groupMode, onGroupModeChange, searchKeyword, onSearchKeywordChange, showGroupModeSwitch }) => {
    const { t } = useTranslation('components');

    return (
      <Flexbox
        horizontal
        align="center"
        className={styles.toolbar}
        gap={4}
        justify="space-between"
        paddingBlock={8}
        paddingInline={8}
        width="100%"
      >
        <Flexbox flex={1} width="100%">
          <SearchBar
            allowClear
            placeholder={t('ModelSwitchPanel.searchPlaceholder')}
            size="small"
            style={{ width: '100%' }}
            styles={{ input: { width: '100%' } }}
            value={searchKeyword}
            variant="borderless"
            onChange={(e) => onSearchKeywordChange(e.target.value)}
            onKeyDown={stopPropagation}
          />
        </Flexbox>
        {showGroupModeSwitch && (
          <Tabs
            activeKey={groupMode}
            size="small"
            style={{ minWidth: 0, width: 'fit-content' }}
            items={[
              {
                key: 'byModel',
                label: (
                  <Tooltip title={t('ModelSwitchPanel.byModel')}>
                    <Icon icon={Brain} />
                  </Tooltip>
                ),
              },
              {
                key: 'byProvider',
                label: (
                  <Tooltip title={t('ModelSwitchPanel.byProvider')}>
                    <Icon icon={ProviderIcon} />
                  </Tooltip>
                ),
              },
            ]}
            onChange={(key) => onGroupModeChange?.(key as GroupMode)}
          />
        )}
      </Flexbox>
    );
  },
);

Toolbar.displayName = 'Toolbar';
