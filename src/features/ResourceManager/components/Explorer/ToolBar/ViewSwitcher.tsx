import { Icon } from '@lobehub/ui';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { Grid3x3Icon, ListIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useViewMode } from '../hooks/useViewMode';
import ActionIconWithChevron from './ActionIconWithChevron';

/**
 * Self-contained view mode switcher with automatic URL sync
 */
const ViewSwitcher = memo(() => {
  const { t } = useTranslation('components');

  const [viewMode, setViewMode] = useViewMode();

  const currentViewIcon = viewMode === 'list' ? ListIcon : Grid3x3Icon;
  const currentViewLabel =
    viewMode === 'list' ? t('FileManager.view.list') : t('FileManager.view.masonry');

  const menuItems = useMemo<MenuProps['items']>(() => {
    return [
      {
        icon: <Icon icon={ListIcon} />,
        key: 'list',
        label: t('FileManager.view.list'),
        onClick: () => setViewMode('list'),
      },
      {
        icon: <Icon icon={Grid3x3Icon} />,
        key: 'masonry',
        label: t('FileManager.view.masonry'),
        onClick: () => setViewMode('masonry'),
      },
    ];
  }, [setViewMode, t]);

  return (
    <Dropdown
      menu={{ items: menuItems, selectedKeys: [viewMode] }}
      placement="bottomRight"
      trigger={['click']}
    >
      <ActionIconWithChevron icon={currentViewIcon} title={currentViewLabel} />
    </Dropdown>
  );
});

export default ViewSwitcher;
