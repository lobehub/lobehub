'use client';

import { Icon } from '@lobehub/ui';
import { type TabBarProps } from '@lobehub/ui/mobile';
import { TabBar } from '@lobehub/ui/mobile';
import * as stylex from '@stylexjs/stylex';
import { Compass, MessageSquare, User } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useMobileNavigation } from '@/hooks/useMobileNavigation';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import moduleStyles from './NavBar.module.css';

const styles = stylex.create({
  container: {
    position: 'fixed',
    zIndex: 100,
    insetBlockEnd: 0,
    insetInline: 0,
  },
});

const NavBar = memo(() => {
  const { t } = useTranslation('common');
  const { activeKey } = useMobileNavigation();
  const navigate = useWorkspaceAwareNavigate();

  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

  const items: TabBarProps['items'] = useMemo(
    () =>
      [
        {
          icon: (active: boolean) => (
            <Icon className={active ? moduleStyles.active : undefined} icon={MessageSquare} />
          ),
          key: SidebarTabKey.Chat,
          onClick: () => {
            navigate('/agent');
          },
          title: t('tab.chat'),
        },
        showMarket && {
          icon: (active: boolean) => (
            <Icon className={active ? moduleStyles.active : undefined} icon={Compass} />
          ),
          key: SidebarTabKey.Community,
          onClick: () => {
            navigate('/community');
          },
          title: t('tab.community'),
        },
        {
          icon: (active: boolean) => (
            <Icon className={active ? moduleStyles.active : undefined} icon={User} />
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
      className={stylex.props(styles.container).className}
      height={MOBILE_TABBAR_HEIGHT}
      items={items}
    />
  );
});

NavBar.displayName = 'NavBar';

export default NavBar;
