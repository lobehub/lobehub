'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Tabs, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, HistoryIcon, LayersIcon, ListIcon, SquareUserIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AssistantNavKey } from '@/types/discover';

import { useDetailContext } from '../DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    link: css`
      color: ${cssVar.colorTextDescription};

      &:hover {
        color: ${cssVar.colorInfo};
      }
    `,
    nav: css`
      border-block-end: 1px solid ${cssVar.colorBorder};
    `,
    tabsWrapper: css`
      scrollbar-width: none;
      overflow-x: auto;
      flex: 1;
      min-width: 0;

      &::-webkit-scrollbar {
        display: none;
      }
    `,
  };
});
interface NavProps {
  activeTab?: AssistantNavKey;
  mobile?: boolean;
  setActiveTab?: (tab: AssistantNavKey) => void;
}

const Nav = memo<NavProps>(({ mobile, setActiveTab, activeTab = AssistantNavKey.Overview }) => {
  const { t } = useTranslation('discover');
  const { pluginCount, knowledgeCount } = useDetailContext();

  const capabilitiesCount = Number(pluginCount) + Number(knowledgeCount);

  const nav = (
    <Tabs
      activeKey={activeTab}
      compact={mobile}
      items={[
        {
          icon: <Icon icon={BookOpenIcon} size={16} />,
          key: AssistantNavKey.Overview,
          label: t('assistants.details.overview.title'),
        },
        {
          icon: <Icon icon={SquareUserIcon} size={16} />,
          key: AssistantNavKey.SystemRole,
          label: t('assistants.details.systemRole.title'),
        },
        {
          icon: <Icon icon={LayersIcon} size={16} />,
          key: AssistantNavKey.Capabilities,
          label:
            capabilitiesCount > 1 ? (
              <Flexbox
                horizontal
                align={'center'}
                gap={6}
                style={{
                  display: 'inline-flex',
                }}
              >
                {t('assistants.details.capabilities.title')}
                <Tag>{capabilitiesCount}</Tag>
              </Flexbox>
            ) : (
              t('assistants.details.capabilities.title')
            ),
        },
        {
          icon: <Icon icon={HistoryIcon} size={16} />,
          key: AssistantNavKey.Version,
          label: t('assistants.details.version.title'),
        },
        {
          icon: <Icon icon={ListIcon} size={16} />,
          key: AssistantNavKey.Related,
          label: t('assistants.details.related.title'),
        },
      ]}
      onChange={(key) => setActiveTab?.(key as AssistantNavKey)}
    />
  );

  return mobile ? (
    nav
  ) : (
    <Flexbox horizontal align={'center'} className={styles.nav} justify={'space-between'}>
      <div className={styles.tabsWrapper}>{nav}</div>
      <Flexbox horizontal flex="none" gap={12} style={{ marginInlineStart: 12 }}>
        <a className={styles.link} href={SOCIAL_URL.discord} rel="noreferrer" target="_blank">
          {t('mcp.details.nav.needHelp')}
        </a>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
