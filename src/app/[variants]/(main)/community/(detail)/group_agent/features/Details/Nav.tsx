import { TabsNav } from '@lobehub/ui';
import { useQueryState } from 'nuqs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResponsive } from '@/hooks/useResponsive';
import { useDetailData } from '../DetailProvider';

export enum GroupAgentNavKey {
  Members = 'members',
  Overview = 'overview',
  Versions = 'versions',
}

const Nav = memo(() => {
  const { t } = useTranslation('discover');
  const { mobile } = useResponsive();
  const [activeTab = GroupAgentNavKey.Overview, setActiveTab] = useQueryState('activeTab');
  const data = useDetailData();

  const memberCount = data.memberAgents?.length || 0;

  const items = [
    {
      key: GroupAgentNavKey.Overview,
      label: t('tabs.overview', { defaultValue: 'Overview' }),
    },
    {
      key: GroupAgentNavKey.Members,
      label: t('tabs.members', { defaultValue: `Members (${memberCount})` }),
    },
    {
      key: GroupAgentNavKey.Versions,
      label: t('tabs.versions', { defaultValue: 'Versions' }),
    },
  ];

  return (
    <TabsNav
      activeKey={activeTab}
      items={items}
      onChange={(key) => setActiveTab(key)}
      style={{
        ...(mobile ? { marginInline: -16 } : {}),
      }}
      variant={mobile ? 'compact' : 'default'}
    />
  );
});

export default Nav;
