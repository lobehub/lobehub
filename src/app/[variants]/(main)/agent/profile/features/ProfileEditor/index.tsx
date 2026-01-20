'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Button, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import isEqual from 'fast-deep-equal';
import { Clock, PlayIcon } from 'lucide-react';
import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import ModelSelect from '@/features/ModelSelect';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import AgentCronJobs from '../AgentCronJobs';
import EditorCanvas from '../EditorCanvas';
import AgentPublishButton from '../Header/AgentPublishButton';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';

const ProfileEditor = memo(() => {
  const { t } = useTranslation('setting');
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const updateConfig = useAgentStore((s) => s.updateAgentConfig);
  const agentId = useAgentStore((s) => s.activeAgentId);
  const switchTopic = useChatStore((s) => s.switchTopic);
  const router = useQueryRoute();

  const handleCreateCronJob = useCallback(() => {
    if (!agentId) return;
    router.push(urlJoin('/agent', agentId, 'cron', 'new'));
  }, [agentId, router]);

  return (
    <>
      <Flexbox
        onClick={(e) => {
          e.stopPropagation();
        }}
        style={{ cursor: 'default', marginBottom: 12 }}
      >
        {/* Header: Avatar + Name + Description */}
        <AgentHeader />
        {/* Config Bar: Model Selector */}
        <Flexbox
          align={'center'}
          gap={8}
          horizontal
          justify={'flex-start'}
          style={{ marginBottom: 12 }}
        >
          <ModelSelect
            onChange={updateConfig}
            value={{
              model: config.model,
              provider: config.provider,
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
              if (!agentId) return;
              // Clear topicId before navigating to prevent stale state
              switchTopic(null, { skipRefreshMessage: true });
              router.push(urlJoin('/agent', agentId));
            }}
            type={'primary'}
          >
            {t('startConversation')}
          </Button>
          <AgentPublishButton />
          {ENABLE_BUSINESS_FEATURES && (
            <Button icon={Clock} onClick={handleCreateCronJob}>
              {t('agentCronJobs.addJob')}
            </Button>
          )}
        </Flexbox>
      </Flexbox>
      <Divider />
      {/* Main Content: Prompt Editor */}
      <EditorCanvas />
      {/* Agent Cron Jobs Display (only show if jobs exist) */}
      {ENABLE_BUSINESS_FEATURES && <AgentCronJobs />}
    </>
  );
});

export default ProfileEditor;
