'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Tabs } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BookOpenIcon, HistoryIcon, SquareUserIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  link: { color: { 'default': cssVar.colorTextDescription, ':hover': cssVar.colorInfo } },
  nav: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
  },
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
      variant="square"
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
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.nav).className}
      justify={'space-between'}
    >
      {nav}
      <Flexbox
        horizontal
        flex="none"
        gap={12}
        style={{ marginInlineStart: 12, whiteSpace: 'nowrap' }}
      >
        <a
          {...stylex.props(styles.link)}
          href={SOCIAL_URL.discord}
          rel="noreferrer"
          target="_blank"
        >
          {t('groupAgents.details.nav.needHelp', { defaultValue: 'Need help?' })}
        </a>
      </Flexbox>
    </Flexbox>
  );
});

export default Nav;
