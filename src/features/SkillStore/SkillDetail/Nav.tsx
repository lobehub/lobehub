'use client';

import { Flexbox, Icon, Tabs, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, BotIcon, CodeIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from './DetailContext';

const styles = createStaticStyles(({ css, cssVar }) => ({
  nav: css`
    border-block-end: 1px solid ${cssVar.colorBorder};
  `,
  tabs: css`
    scrollbar-width: none;
    overflow-x: auto;
    flex: 1;
    min-width: 0;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

export type TabKey = 'agents' | 'overview' | 'schema';

interface NavProps {
  activeTab?: TabKey;
  mobile?: boolean;
  setActiveTab?: (tab: TabKey) => void;
}

const Nav = memo<NavProps>(({ activeTab = 'overview', setActiveTab, mobile }) => {
  const { t } = useTranslation('plugin');
  const { agents, agentsLoading, tools } = useDetailContext();
  const toolsCount = tools.length;
  const agentsCount = agents.length;

  const items = useMemo(() => {
    const baseItems = [
      {
        icon: <Icon icon={BookOpenIcon} size={16} />,
        key: 'overview',
        label: t('skillDetail.tabs.overview'),
      },
      {
        icon: <Icon icon={CodeIcon} size={16} />,
        key: 'schema',
        label:
          toolsCount > 0 ? (
            <Flexbox align="center" gap={6} horizontal style={{ display: 'inline-flex' }}>
              {t('skillDetail.tabs.tools')}
              <Tag>{toolsCount}</Tag>
            </Flexbox>
          ) : (
            t('skillDetail.tabs.tools')
          ),
      },
    ];

    // Only show agents tab if there are agents (and not loading)
    if (!agentsLoading && agentsCount > 0) {
      baseItems.push({
        icon: <Icon icon={BotIcon} size={16} />,
        key: 'agents',
        label: (
          <Flexbox align="center" gap={6} horizontal style={{ display: 'inline-flex' }}>
            {t('skillDetail.tabs.agents')}
            <Tag>{agentsCount}</Tag>
          </Flexbox>
        ),
      });
    }

    return baseItems;
  }, [t, toolsCount, agentsCount, agentsLoading]);

  return (
    <Flexbox className={styles.nav}>
      <Tabs
        activeKey={activeTab}
        className={styles.tabs}
        compact={mobile}
        items={items}
        onChange={(key) => setActiveTab?.(key as TabKey)}
      />
    </Flexbox>
  );
});

export default Nav;
