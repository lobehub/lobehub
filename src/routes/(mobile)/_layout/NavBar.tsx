'use client';

import {
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- Icon renders its svg without a slot; TabBar has no tab/title slot
  createStaticStyles,
  Icon,
} from '@lobehub/ui';
import { type TabBarProps } from '@lobehub/ui/mobile';
import { TabBar } from '@lobehub/ui/mobile';
import * as stylex from '@stylexjs/stylex';
import { Compass, MessageSquare, User } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_TABBAR_HEIGHT } from '@/const/layoutTokens';
import { getMarketplaceEntryPath } from '@/features/Marketplace/paths';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useMobileNavigation } from '@/hooks/useMobileNavigation';
import { SidebarTabKey } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  container: {
    position: 'fixed',
    zIndex: 100,
    insetBlockEnd: 0,
    insetInline: 0,
  },
});

const fallback = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    svg {
      fill: color-mix(in srgb, ${cssVar.colorPrimary} 33%, transparent);
    }
  `,
  /**
   * @lobehub/ui fixes every tab at 48px and ellipsizes its 12px label, which
   * cuts "Marketplace" (~69px) to "Market…". Each tab takes an equal share of
   * the bar instead: the icons keep the space-around positions (1/6, 1/2, 5/6),
   * the tap target spans the column, and the label gets ~125px at 375px.
   */
  tabBar: css`
    .lobe-mobile-tab-bar__tab {
      flex: 1 1 0;
      min-width: 0;
      width: auto;
      padding-inline: 4px;
    }
  `,
}));

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
            <Icon className={active ? fallback.active : undefined} icon={MessageSquare} />
          ),
          key: SidebarTabKey.Chat,
          onClick: () => {
            navigate('/agent');
          },
          title: t('tab.chat'),
        },
        // Always shown: installed skills and connectors live in the Marketplace,
        // so with the market off it opens straight on the installed skills.
        {
          icon: (active: boolean) => (
            <Icon className={active ? fallback.active : undefined} icon={Compass} />
          ),
          key: SidebarTabKey.Community,
          onClick: () => {
            navigate(getMarketplaceEntryPath(showMarket));
          },
          title: t('tab.marketplace'),
        },
        {
          icon: (active: boolean) => (
            <Icon className={active ? fallback.active : undefined} icon={User} />
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
      {...sx(styles.container, fallback.tabBar)}
      height={MOBILE_TABBAR_HEIGHT}
      items={items}
    />
  );
});

NavBar.displayName = 'NavBar';

export default NavBar;
