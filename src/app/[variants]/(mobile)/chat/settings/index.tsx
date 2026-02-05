'use client';

import { Tabs } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MobileHeader from '@/app/[variants]/(mobile)/chat/settings/_layout/Header';
import PageTitle from '@/components/PageTitle';
import MobileContentLayout from '@/components/server/MobileNavLayout';
import { useCategory } from '@/features/AgentSetting/AgentCategory/useCategory';
import AgentSettings from '@/features/AgentSetting/AgentSettings';
import Footer from '@/features/Setting/Footer';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';
import { useSessionStore } from '@/store/session';

export default memo(() => {
  const { t } = useTranslation('setting');
  const [tab, setTab] = useState(ChatSettingsTabs.Prompt);
  const cateItems = useCategory();
  const id = useSessionStore((s) => s.activeId);

  const [updateAgentConfig, updateAgentMeta, config, meta, title] = useAgentStore((s) => [
    s.updateAgentConfig,
    s.updateAgentMeta,
    agentSelectors.currentAgentConfig(s),
    agentSelectors.currentAgentMeta(s),
    agentSelectors.currentAgentTitle(s),
  ]);

  const isLoading = false;

  return (
    <MobileContentLayout header={<MobileHeader />}>
      <PageTitle title={t('header.sessionWithName', { name: title })} />
      <Tabs
        compact
        activeKey={tab}
        items={cateItems as any}
        style={{
          borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
        }}
        onChange={(value) => setTab(value as ChatSettingsTabs)}
      />
      <AgentSettings
        config={config}
        id={id}
        loading={isLoading}
        meta={meta}
        tab={tab}
        onConfigChange={updateAgentConfig}
        onMetaChange={updateAgentMeta}
      />
      <Footer />
    </MobileContentLayout>
  );
});
