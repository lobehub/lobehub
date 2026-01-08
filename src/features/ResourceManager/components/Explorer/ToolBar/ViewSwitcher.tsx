import { Dropdown, Icon } from '@lobehub/ui';
import { Grid3x3Icon, ListIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MenuProps } from '@/components/Menu';

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

  const menuItems: MenuProps['items'] = useMemo(
    () => [
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
    ],
    [setViewMode, t],
  );

  return (
    <Dropdown
      arrow={false}
      menu={{
        items: menuItems,
        selectable: true,
        selectedKeys: [viewMode],
      }}
      placement="bottomRight"
    >
      <ActionIconWithChevron icon={currentViewIcon} title={currentViewLabel} />
    </Dropdown>
  );
});

export default ViewSwitcher;
