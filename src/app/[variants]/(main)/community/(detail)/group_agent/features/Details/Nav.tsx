'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Tabs, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BookOpenIcon, HistoryIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailData } from '../DetailProvider';

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
  Members = 'members',
  Overview = 'overview',
  Versions = 'versions',
}

interface NavProps {
  activeTab?: GroupAgentNavKey;
  mobile?: boolean;
  setActiveTab?: (tab: GroupAgentNavKey) => void;
}

const Nav = memo<NavProps>(({ mobile, setActiveTab, activeTab = GroupAgentNavKey.Overview }) => {
  const { t } = useTranslation('discover');
  const data = useDetailData();

  const memberCount = data.memberAgents?.length || 0;

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
          icon: <Icon icon={UsersIcon} size={16} />,
          key: GroupAgentNavKey.Members,
          label:
            memberCount > 0 ? (
              <Flexbox
                align={'center'}
                gap={6}
                horizontal
                style={{
                  display: 'inline-flex',
                }}
              >
                {t('groupAgents.details.members.title', { defaultValue: 'Members' })}
                <Tag>{memberCount}</Tag>
              </Flexbox>
            ) : (
              t('groupAgents.details.members.title', { defaultValue: 'Members' })
            ),
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
    <Flexbox align={'center'} className={styles.nav} horizontal justify={'space-between'}>
      {nav}
      <Flexbox gap={12} horizontal>
        <a className={styles.link} href={SOCIAL_URL.discord} rel="noreferrer" target="_blank">
          {t('groupAgents.details.nav.needHelp', { defaultValue: 'Need help?' })}
        </a>
        <a
          className={styles.link}
          href="https://github.com/lobehub/lobe-chat/issues/new/choose"
          rel="noreferrer"
          target="_blank"
        >
          {t('groupAgents.details.nav.reportIssue', { defaultValue: 'Report issue' })}
        </a>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
