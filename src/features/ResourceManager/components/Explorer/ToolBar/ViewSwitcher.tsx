import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
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

  const menuItems = useMemo<DropdownItem[]>(() => {
    return [
      {
        icon: <Icon icon={ListIcon} />,
        key: 'list',
        label: t('FileManager.view.list'),
        onClick: () => setViewMode('list'),
        style: viewMode === 'list' ? { backgroundColor: 'var(--ant-control-item-bg-active)' } : {},
      },
      {
        icon: <Icon icon={Grid3x3Icon} />,
        key: 'masonry',
        label: t('FileManager.view.masonry'),
        onClick: () => setViewMode('masonry'),
        style:
          viewMode === 'masonry' ? { backgroundColor: 'var(--ant-control-item-bg-active)' } : {},
      },
    ];
  }, [setViewMode, t, viewMode]);

  return (
    <DropdownMenu items={menuItems} placement="bottomRight">
      <ActionIconWithChevron icon={currentViewIcon} title={currentViewLabel} />
    </DropdownMenu>
  );
});

export default ViewSwitcher;
