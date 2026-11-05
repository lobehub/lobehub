'use client';

import { Flexbox, Icon, Tabs } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BookOpenIcon, BotIcon, CodeIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  nav: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
  },
  tabs: {
    'scrollbarWidth': 'none',
    'overflowX': 'auto',
    'flex': '1',
    'minWidth': '0',
    '::-webkit-scrollbar': { display: 'none' },
  },
});

export type TabKey = 'agents' | 'overview' | 'schema';

interface NavProps {
  activeTab?: TabKey;
  mobile?: boolean;
  setActiveTab?: (tab: TabKey) => void;
}

const Nav = memo<NavProps>(({ activeTab = 'overview', setActiveTab }) => {
  const { t } = useTranslation('plugin');

  const items = useMemo(
    () => [
      {
        icon: <Icon icon={BookOpenIcon} size={16} />,
        key: 'overview',
        label: t('skillDetail.tabs.overview'),
      },
      {
        icon: <Icon icon={CodeIcon} size={16} />,
        key: 'schema',
        label: t('skillDetail.tabs.tools'),
      },
      {
        icon: <Icon icon={BotIcon} size={16} />,
        key: 'agents',
        label: t('skillDetail.tabs.agents'),
      },
    ],
    [t],
  );

  return (
    <Flexbox className={stylex.props(styles.nav).className}>
      <Tabs
        activeKey={activeTab}
        className={stylex.props(styles.tabs).className}
        items={items}
        onChange={(key) => setActiveTab?.(key as TabKey)}
      />
    </Flexbox>
  );
});

export default Nav;
