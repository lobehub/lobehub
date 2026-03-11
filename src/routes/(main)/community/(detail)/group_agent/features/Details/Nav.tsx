'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Tabs } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, HistoryIcon, SquareUserIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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
  };
});

export enum GroupAgentNavKey {
  Overview = 'overview',
  SystemRole = 'systemRole',
  Versions = 'versions',
}

interface NavProps {
  activeTab?: GroupAgentNavKey;
  mobile?: boolean;
  setActiveTab?: (tab: GroupAgentNavKey) => void;
}

const Nav = memo<NavProps>(({ mobile, setActiveTab, activeTab = GroupAgentNavKey.Overview }) => {
  const { t } = useTranslation('discover');

  const nav = (
    <Tabs
      activeKey={activeTab}
      compact={mobile}
      items={[
        {
          icon: <Icon icon={BookOpenIcon} size={16} />,
          key: GroupAgentNavKey.Overview,
          label: t('groupAgents.details.overview.title', { defaultValue: 'Overview' }),
        },
        {
          icon: <Icon icon={SquareUserIcon} size={16} />,
          key: GroupAgentNavKey.SystemRole,
          label: t('groupAgents.details.systemRole.title', { defaultValue: 'System Role' }),
        },
        {
          icon: <Icon icon={HistoryIcon} size={16} />,
          key: GroupAgentNavKey.Versions,
          label: t('groupAgents.details.versions.title', { defaultValue: 'Versions' }),
        },
      ]}
      onChange={(key) => setActiveTab?.(key as GroupAgentNavKey)}
    />
  );

  return mobile ? (
    nav
  ) : (
    <Flexbox horizontal align={'center'} className={styles.nav} justify={'space-between'}>
      {nav}
      <Flexbox horizontal gap={12}>
        <a className={styles.link} href={SOCIAL_URL.discord} rel="noreferrer" target="_blank">
          {t('groupAgents.details.nav.needHelp', { defaultValue: 'Need help?' })}
        </a>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
