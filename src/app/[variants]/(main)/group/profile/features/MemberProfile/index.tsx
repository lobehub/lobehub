'use client';

import { Alert, Button, Flexbox, Icon } from '@lobehub/ui';
import { Divider } from 'antd';
import isEqual from 'fast-deep-equal';
import { InfoIcon, PlayIcon } from 'lucide-react';
import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { EditorCanvas } from '@/features/EditorCanvas';
import ModelSelect from '@/features/ModelSelect';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useGroupProfileStore } from '@/store/groupProfile';

import AutoSaveHint from '../Header/AutoSaveHint';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';

const MemberProfile = memo(() => {
  const { t } = useTranslation(['setting', 'chat']);

  // Get agentId from profile store (activeTabId is the selected agent ID)
  const agentId = useGroupProfileStore((s) => s.activeTabId);
  const editor = useGroupProfileStore((s) => s.editor);
  const handleContentChange = useGroupProfileStore((s) => s.handleContentChange);

  // Get agent config by agentId
  const config = useAgentStore(agentByIdSelectors.getAgentConfigById(agentId), isEqual);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const groupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const currentGroup = useAgentGroupStore(agentGroupSelectors.currentGroup);
  const currentGroupAgents = useAgentGroupStore(agentGroupSelectors.currentGroupAgents);
  const router = useQueryRoute();

  // Check if the current agent is the supervisor
  const isSupervisor = currentGroup?.supervisorAgentId === agentId;

  // Compute isExternal based on group member properties
  const isExternal = useMemo(() => {
    const agent = currentGroupAgents.find((a) => a.id === agentId);
    return agent ? !agent.isSupervisor && !agent.virtual : false;
  }, [currentGroupAgents, agentId]);

  // Wrap updateAgentConfigById for saving editor content
  const updateContent = useCallback(
    async (payload: { content: string; editorData: Record<string, any> }) => {
      await updateAgentConfigById(agentId, {
        editorData: payload.editorData,
        systemRole: payload.content,
      });
    },
    [updateAgentConfigById, agentId],
  );

  // Handle editor content change
  const onContentChange = useCallback(() => {
    handleContentChange(updateContent);
  }, [handleContentChange, updateContent]);

  // Wrap updateAgentConfigById for ModelSelect
  const updateAgentConfig = useCallback(
    async (config: { model?: string; provider?: string }) => {
      await updateAgentConfigById(agentId, config);
    },
    [updateAgentConfigById, agentId],
  );

  return (
    <>
      {/* External agent warning or AutoSaveHint */}
      <Flexbox height={66} width={'100%'}>
        {isExternal && !isSupervisor && (
          <Alert
            icon={<Icon icon={InfoIcon} />}
            style={{ width: '100%' }}
            title={t('group.profile.externalAgentWarning', { ns: 'chat' })}
            type="secondary"
            variant={'outlined'}
          />
        )}
        <Flexbox paddingBlock={12}>
          <AutoSaveHint />
        </Flexbox>
      </Flexbox>
      <Flexbox
        onClick={(e) => {
          e.stopPropagation();
        }}
        style={{ cursor: 'default', marginBottom: 12 }}
      >
        {/* Header: Avatar + Name */}
        <AgentHeader readOnly={isSupervisor} />
        {/* Config Bar: Model Selector */}
        <Flexbox
          align={'center'}
          gap={8}
          horizontal
          justify={'flex-start'}
          style={{ marginBottom: 12 }}
        >
          <ModelSelect
            onChange={updateAgentConfig}
            value={{
              model: config?.model,
              provider: config?.provider,
            }}
          />
        </Flexbox>
        <AgentTool />
        <Flexbox
          align={'center'}
          gap={8}
          horizontal
          justify={'flex-start'}
          style={{ marginTop: 16 }}
        >
          <Button
            icon={PlayIcon}
            onClick={() => {
              if (!groupId) return;
              router.push(urlJoin('/group', groupId));
            }}
            type={'primary'}
          >
            {t('startConversation')}
          </Button>
        </Flexbox>
      </Flexbox>
      <Divider />
      {/* Main Content: Prompt Editor */}
      <EditorCanvas
        editor={editor}
        editorData={{
          content: config?.systemRole,
          editorData: config?.editorData,
        }}
        key={agentId}
        onContentChange={onContentChange}
        placeholder={
          isSupervisor
            ? t('group.profile.supervisorPlaceholder', { ns: 'chat' })
            : t('settingAgent.prompt.placeholder')
        }
      />
    </>
  );
});

export default MemberProfile;
