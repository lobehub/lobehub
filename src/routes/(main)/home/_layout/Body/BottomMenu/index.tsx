import { type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { EyeOffIcon, MoreHorizontalIcon, SlidersHorizontalIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useNavLayout } from '@/hooks/useNavLayout';
import { openCustomizeSidebarModal } from '@/routes/(main)/home/_layout/Body/CustomizeSidebarModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isModifierClick } from '@/utils/navigation';
import { prefetchRoute } from '@/utils/router';

const BottomMenu = memo(() => {
  const { t } = useTranslation('common');
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { bottomMenuItems: items } = useNavLayout();
  const [hiddenSections, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.hiddenSidebarSections(s),
    s.updateSystemStatus,
  ]);

  const hideSection = useCallback(
    (key: string) => {
      updateSystemStatus({ hiddenSidebarSections: [...hiddenSections, key] });
    },
    [hiddenSections, updateSystemStatus],
  );

  const getContextMenuItems = useCallback(
    (key: string): MenuProps['items'] => [
      {
        icon: <Icon icon={EyeOffIcon} />,
        key: 'hideSection',
        label: t('navPanel.hideSection'),
        onClick: () => hideSection(key),
      },
      { type: 'divider' as const },
      {
        icon: <Icon icon={SlidersHorizontalIcon} />,
        key: 'customizeSidebar',
        label: t('navPanel.customizeSidebar'),
        onClick: () => openCustomizeSidebarModal(),
      },
    ],
    [t, hideSection],
  );

  const visibleItems = items.filter((item) => !item.hidden && !hiddenSections.includes(item.key));

  if (visibleItems.length === 0) return null;

  return (
    <Flexbox
      gap={1}
      paddingBlock={4}
      style={{
        marginTop: 12,
        overflow: 'hidden',
      }}
    >
      {visibleItems.map((item) => (
        <Link
          key={item.key}
          to={item.url!}
          onMouseEnter={() => prefetchRoute(item.url!)}
          onClick={(e) => {
            if (isModifierClick(e)) return;
            e.preventDefault();
            navigate(item.url!);
          }}
        >
          <NavItem
            active={tab === item.key}
            contextMenuItems={getContextMenuItems(item.key)}
            icon={item.icon}
            title={item.title}
            actions={
              <DropdownMenu items={getContextMenuItems(item.key)} nativeButton={false}>
                <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
              </DropdownMenu>
            }
          />
        </Link>
      ))}
    </Flexbox>
  );
});

export default BottomMenu;
