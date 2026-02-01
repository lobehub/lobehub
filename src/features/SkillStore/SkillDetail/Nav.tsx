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
  const { tools, toolsLoading } = useDetailContext();
  const toolsCount = tools.length;

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
        label:
          !toolsLoading && toolsCount > 0 ? (
            <Flexbox align="center" gap={6} horizontal style={{ display: 'inline-flex' }}>
              {t('skillDetail.tabs.tools')}
              <Tag>{toolsCount}</Tag>
            </Flexbox>
          ) : (
            t('skillDetail.tabs.tools')
          ),
      },
      {
        icon: <Icon icon={BotIcon} size={16} />,
        key: 'agents',
        label: t('skillDetail.tabs.agents'),
      },
    ],
    [t, toolsCount, toolsLoading],
  );

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
