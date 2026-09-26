'use client';

import { Flexbox } from '@lobehub/ui';
import {
  BrainCircuitIcon,
  BubblesIcon,
  CalendarClockIcon,
  HeartPulseIcon,
  ScaleIcon,
  SearchIcon,
  SignatureIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/slices/preference/selectors/labPrefer';
import { isModifierClick } from '@/utils/navigation';

interface Item {
  icon: NavItemProps['icon'];
  key: string;
  onClick?: () => void;
  title: NavItemProps['title'];
  url?: string;
}

enum MemoryTabKey {
  Activities = 'activities',
  Contexts = 'contexts',
  Home = 'home',
  Identities = 'identities',
  Preferences = 'preferences',
  Rules = 'rules',
}

const useActiveTabKey = () => {
  const { pathname } = useActiveLocation();
  if (pathname === '/memory') return MemoryTabKey.Home;
  return (pathname.split('/memory/').find(Boolean)! as MemoryTabKey) || MemoryTabKey.Home;
};

const Nav = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('memory');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const enableRules = useUserStore(labPreferSelectors.enableMemoryRules);

  /**
   * Four groups, separated by space rather than rules: what the whole section is (home), what it
   * requires of a delivery (rules), who the person is (identity, preferences), and what is
   * going on around them (contexts, activities). Search sits above all of them because it is an
   * action, not a destination.
   */
  const groups: Item[][] = useMemo(
    () => [
      [
        {
          icon: SearchIcon,
          key: 'search',
          onClick: () => {
            toggleCommandMenu(true);
          },
          title: t('tab.search'),
        },
      ],
      [
        {
          icon: BrainCircuitIcon,
          key: MemoryTabKey.Home,
          title: t('tab.home'),
          url: '/memory',
        },
      ],
      // Rules are still an alpha lab: the group disappears with the flag rather than sitting
      // there disabled, so the sidebar of everyone else reads exactly as before.
      ...(enableRules
        ? [
            [
              {
                icon: ScaleIcon,
                key: MemoryTabKey.Rules,
                title: t('tab.rules'),
                url: '/memory/rules',
              },
            ],
          ]
        : []),
      [
        {
          icon: SignatureIcon,
          key: MemoryTabKey.Identities,
          title: t('tab.identities'),
          url: '/memory/identities',
        },
        {
          icon: HeartPulseIcon,
          key: MemoryTabKey.Preferences,
          title: t('tab.preferences'),
          url: '/memory/preferences',
        },
      ],
      [
        {
          icon: BubblesIcon,
          key: MemoryTabKey.Contexts,
          title: t('tab.contexts'),
          url: '/memory/contexts',
        },
        {
          icon: CalendarClockIcon,
          key: MemoryTabKey.Activities,
          title: t('tab.activities'),
          url: '/memory/activities',
        },
      ],
    ],
    [t, toggleCommandMenu, enableRules],
  );

  return (
    <Flexbox gap={12} paddingInline={4}>
      {groups.map((items, index) => (
        <Flexbox gap={1} key={index}>
          {items.map((item) => {
            const content = (
              <NavItem
                active={tab === item.key}
                icon={item.icon}
                key={item.key}
                title={item.title}
                onClick={item.onClick}
              />
            );
            if (!item.url) return content;

            return (
              <Link
                key={item.key}
                to={item.url}
                onClick={(e) => {
                  if (isModifierClick(e)) return;
                  e.preventDefault();
                  item?.onClick?.();
                  if (item.url) {
                    navigate(item.url);
                  }
                }}
              >
                <NavItem active={tab === item.key} icon={item.icon} title={item.title} />
              </Link>
            );
          })}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default Nav;
