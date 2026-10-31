'use client';

import { cssVar, Tabs } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useNavigate } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { useCategory } from '@/features/AgentSetting/AgentCategory/useCategory';
import AgentSettings from '@/features/AgentSetting/AgentSettings';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import Footer from '@/features/Setting/Footer';
import { usePermission } from '@/hooks/usePermission';
import MobileHeader from '@/routes/(mobile)/chat/settings/_layout/Header';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

export default memo(() => {
  const cateItems = useCategory();
  const navigate = useNavigate();
  // The agent profile (identity, model, instructions) is edited on the profile
  // page; the settings sheet only renders the tabs below it.
  const [tab, setTab] = useState(
    () =>
      (cateItems?.find((item) => item?.key !== ChatSettingsTabs.Prompt)?.key ??
        ChatSettingsTabs.Opening) as ChatSettingsTabs,
  );
  const id = useAgentStore((s) => s.activeAgentId);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { canEditResource, isAccessResolved } = useResourceAccess('agent', id);

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
        activeKey={tab}
        items={cateItems as any}
        style={{
          borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
        }}
        onChange={(value) => {
          if (value === ChatSettingsTabs.Prompt) {
            navigate('../profile', { relative: 'path' });
            return;
          }
          setTab(value as ChatSettingsTabs);
        }}
      />
      <AgentSettings
        config={config}
        disabled={!canEdit || !isAccessResolved || !canEditResource}
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
