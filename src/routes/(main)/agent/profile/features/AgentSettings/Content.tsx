'use client';

import isEqual from 'fast-deep-equal';
import { ActivityIcon, MessageSquareHeartIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import {
  AgentSettings as Settings,
  SettingsModalLayout,
  type SettingsModalTabItem,
} from '@/features/AgentSetting';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const TAB_META = {
  [ChatSettingsTabs.Opening]: { icon: MessageSquareHeartIcon, labelKey: 'agentTab.opening' },
  [ChatSettingsTabs.SelfIteration]: {
    icon: ActivityIcon,
    labelKey: 'agentTab.selfIteration',
  },
} as const;

const Content = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [agentId, isInbox] = useAgentStore(
    (s) => [s.activeAgentId, builtinAgentSelectors.isInboxAgent(s)],
    shallow,
  );
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const { enableAgentSelfIteration } = useServerConfigStore(featureFlagsSelectors);
  const [tab, setTab] = useState(ChatSettingsTabs.Opening);

  const availableTabs = useMemo(
    () =>
      [
        ChatSettingsTabs.Opening,
        enableAgentSelfIteration ? ChatSettingsTabs.SelfIteration : null,
      ].filter(Boolean) as ChatSettingsTabs[],
    [enableAgentSelfIteration],
  );

  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0];

  useEffect(() => {
    if (activeTab && activeTab !== tab) setTab(activeTab);
  }, [activeTab, tab]);

  const updateAgentConfig = async (config: any) => {
    if (!canEdit) return;
    if (!agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentConfig(agentId, config);
  };

  const updateAgentMeta = async (meta: any) => {
    if (!canEdit) return;
    if (!agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentMeta(agentId, meta);
  };

  const tabs: SettingsModalTabItem[] = useMemo(
    () =>
      availableTabs.map((key) => {
        const entry = TAB_META[key as keyof typeof TAB_META];
        return { icon: entry.icon, key, label: t(entry.labelKey) };
      }),
    [availableTabs, t],
  );

  const displayTitle = isInbox ? 'Lobe AI' : meta.title || t('defaultSession', { ns: 'common' });

  return (
    <SettingsModalLayout
      activeTab={activeTab}
      avatar={isInbox ? DEFAULT_INBOX_AVATAR : meta.avatar || DEFAULT_AVATAR}
      background={meta.backgroundColor || undefined}
      tabs={tabs}
      title={displayTitle}
      onTabChange={(key) => setTab(key as ChatSettingsTabs)}
    >
      {activeTab && (
        <Settings
          config={config}
          disabled={!canEdit}
          id={agentId}
          loading={false}
          meta={meta}
          tab={activeTab}
          onConfigChange={updateAgentConfig}
          onMetaChange={updateAgentMeta}
        />
      )}
    </SettingsModalLayout>
  );
});

export default Content;
