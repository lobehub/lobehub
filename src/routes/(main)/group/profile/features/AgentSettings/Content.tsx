'use client';

import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { DEFAULT_AVATAR } from '@/const/meta';
import { AgentSettings as Settings, SettingsModalLayout } from '@/features/AgentSetting';
import { usePermission } from '@/hooks/usePermission';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

const Content = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { gid } = useParams<{ gid: string }>();
  const groupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const currentGroup = useAgentGroupStore((s) => agentGroupSelectors.getGroupById(gid ?? '')(s));

  const updateGroupConfig = async (config: any) => {
    if (!canEdit) return;
    if (!groupId) return;
    const groupConfig = {
      openingMessage: config.openingMessage,
      openingQuestions: config.openingQuestions,
    };
    await useAgentGroupStore.getState().updateGroupConfig(groupConfig);
  };

  const updateGroupMeta = async (meta: any) => {
    if (!canEdit) return;
    if (!groupId) return;
    await useAgentGroupStore.getState().updateGroup(groupId, meta);
  };

  const agentConfig = useMemo(
    () =>
      ({
        chatConfig: {},
        model: '',
        openingMessage: currentGroup?.config?.openingMessage,
        openingQuestions: currentGroup?.config?.openingQuestions,
        params: {},
        systemRole: '',
        tts: {},
      }) as any,
    [currentGroup?.config],
  );

  const agentMeta = useMemo(
    () => ({
      avatar: currentGroup?.avatar || undefined,
      backgroundColor: currentGroup?.backgroundColor || undefined,
      description: currentGroup?.description || undefined,
      tags: [] as string[],
      title: currentGroup?.title || undefined,
    }),
    [currentGroup],
  );

  const displayTitle = currentGroup?.title || t('defaultSession', { ns: 'common' });

  return (
    <SettingsModalLayout
      avatar={currentGroup?.avatar || DEFAULT_AVATAR}
      background={currentGroup?.backgroundColor || undefined}
      title={displayTitle}
    >
      <Settings
        config={agentConfig}
        disabled={!canEdit}
        id={groupId}
        loading={false}
        meta={agentMeta}
        tab={ChatSettingsTabs.Opening}
        onConfigChange={updateGroupConfig}
        onMetaChange={updateGroupMeta}
      />
    </SettingsModalLayout>
  );
});

export default Content;
