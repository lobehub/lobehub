'use client';

import { Icon } from '@lobehub/ui';
import type { TabBarProps } from '@lobehub/ui/mobile';
import { TabBar } from '@lobehub/ui/mobile';
import { createStaticStyles } from 'antd-style';
import { Compass, MessageSquare, User } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePathname } from '@/libs/router/navigation';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    svg {
      fill: color-mix(in srgb, ${cssVar.colorPrimary} 33%, transparent);
    }
  `,
  container: css`
    position: fixed;
    z-index: 100;
    inset-block-end: 0;
    inset-inline: 0;

    padding-block-end: env(safe-area-inset-bottom, 0);

    background: ${cssVar.colorBgContainer};
  `,
}));

export const getMobileActiveTabKey = (pathname: string): SidebarTabKey => {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return SidebarTabKey.Chat;

  const [firstSegment, secondSegment] = segments;

  if (firstSegment === SidebarTabKey.Community || firstSegment === SidebarTabKey.Me) {
    return firstSegment;
  }

  if (!secondSegment) return SidebarTabKey.Chat;

  if (secondSegment === SidebarTabKey.Community || secondSegment === SidebarTabKey.Me) {
    return secondSegment;
  }

  return SidebarTabKey.Chat;
};

const NavBar = memo(() => {
  const { t } = useTranslation('common');
  const pathname = usePathname();
  const activeKey = getMobileActiveTabKey(pathname);
  const navigate = useWorkspaceAwareNavigate();

  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

  const items: TabBarProps['items'] = useMemo(
    () =>
      [
        {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={MessageSquare} />
          ),
          key: SidebarTabKey.Chat,
          onClick: () => {
            navigate('/');
          },
          title: t('tab.chat'),
        },
        showMarket && {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={Compass} />
          ),
          key: SidebarTabKey.Community,
          onClick: () => {
            navigate('/community');
          },
          title: t('tab.community'),
        },
        {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={User} />
          ),
          key: SidebarTabKey.Me,
          onClick: () => {
            navigate('/me', { escape: true });
          },
          title: t('tab.me'),
        },
      ].filter(Boolean) as TabBarProps['items'],
    [navigate, showMarket, t],
  );

  return (
    <TabBar
      activeKey={activeKey}
      className={styles.container}
      height={MOBILE_TABBAR_HEIGHT}
      items={items}
    />
  );
});

NavBar.displayName = 'NavBar';

export default NavBar;
