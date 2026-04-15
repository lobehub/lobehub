'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useNavLayout } from '@/hooks/useNavLayout';
import { isModifierClick } from '@/utils/navigation';
import { prefetchRoute } from '@/utils/router';

/** Keys that are rendered in the header; all others are managed by Body via sidebarSectionOrder */
const HEADER_KEYS = new Set(['home', 'search']);

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { topNavItems: items } = useNavLayout();

  const newBadge = (
    <Tag color="blue" size="small">
      {t('new')}
    </Tag>
  );

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items
        .filter((item) => HEADER_KEYS.has(item.key))
        .map((item) => {
          const extra = item.isNew ? newBadge : undefined;

          const navItem = (
            <NavItem
              active={tab === item.key}
              extra={extra}
              hidden={item.hidden}
              icon={item.icon as NavItemProps['icon']}
              title={item.title}
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
