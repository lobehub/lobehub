'use client';

import { type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Icon, Tag } from '@lobehub/ui';
import { EyeOffIcon, MoreHorizontalIcon, SlidersHorizontalIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useNavLayout } from '@/hooks/useNavLayout';
import { openCustomizeSidebarModal } from '@/routes/(main)/home/_layout/Body/CustomizeSidebarModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isModifierClick } from '@/utils/navigation';
import { prefetchRoute } from '@/utils/router';

/** Keys that cannot be hidden and should not show section actions */
const PERMANENT_KEYS = new Set(['home', 'search']);

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { topNavItems: items } = useNavLayout();
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

  const getSectionMenuItems = useCallback(
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

  const newBadge = (
    <Tag color="blue" size="small">
      {t('new')}
    </Tag>
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items
        .filter((item) => !hiddenSections.includes(item.key))
        .map((item) => {
          const extra = item.isNew ? newBadge : undefined;
          const canHide = !PERMANENT_KEYS.has(item.key);
          const menuItems = canHide ? getSectionMenuItems(item.key) : undefined;

          const navItem = (
            <NavItem
              active={tab === item.key}
              contextMenuItems={menuItems}
              extra={extra}
              hidden={item.hidden}
              icon={item.icon as NavItemProps['icon']}
              title={item.title}
              actions={
                menuItems ? (
                  <DropdownMenu items={menuItems} nativeButton={false}>
                    <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
                  </DropdownMenu>
                ) : undefined
              }
              onClick={item.onClick}
            />
          );

          if (!item.url) return <div key={item.key}>{navItem}</div>;

          return (
            <Link
              key={item.key}
              to={item.url}
              onMouseEnter={() => prefetchRoute(item.url!)}
              onClick={(e) => {
                if (isModifierClick(e)) return;
                e.preventDefault();
                item?.onClick?.();
                if (item.url) {
                  navigate(item.url);
                }
              }}
            >
              {navItem}
            </Link>
          );
        })}
    </Flexbox>
  );
});

export default Nav;
