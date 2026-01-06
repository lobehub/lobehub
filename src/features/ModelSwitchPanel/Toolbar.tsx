import { Icon, Segmented } from '@lobehub/ui';
import { ProviderIcon } from '@lobehub/ui/icons';
import { Brain } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './styles';
import type { GroupMode } from './types';

interface ToolbarProps {
  currentModelName: string;
  groupMode: GroupMode;
  onGroupModeChange: (mode: GroupMode) => void;
}

export const Toolbar = memo<ToolbarProps>(({ currentModelName, groupMode, onGroupModeChange }) => {
  const { t } = useTranslation('components');

  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarModelName}>{currentModelName}</div>
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
    </div>
  );
});

Toolbar.displayName = 'Toolbar';
