'use client';

import { Tabs } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useState } from 'react';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { useCategory } from '@/features/AgentSetting/AgentCategory/useCategory';
import AgentSettings from '@/features/AgentSetting/AgentSettings';
import Footer from '@/features/Setting/Footer';
import { usePermission } from '@/hooks/usePermission';
import MobileHeader from '@/routes/(mobile)/chat/settings/_layout/Header';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';
import { useSessionStore } from '@/store/session';

export default memo(() => {
  const [tab, setTab] = useState(ChatSettingsTabs.Prompt);
  const cateItems = useCategory();
  const id = useSessionStore((s) => s.activeId);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const [updateAgentConfig, updateAgentMeta, config, meta] = useAgentStore((s) => [
    s.updateAgentConfig,
    s.updateAgentMeta,
    agentSelectors.currentAgentConfig(s),
    agentSelectors.currentAgentMeta(s),
  ]);

  const isLoading = false;

  return (
    <MobileContentLayout header={<MobileHeader />}>
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
        disabled={!canEdit}
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
