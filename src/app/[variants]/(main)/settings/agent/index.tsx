'use client';

import { DEFAULT_REWRITE_QUERY } from '@lobechat/prompts';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import DefaultAgentForm from './features/DefaultAgentForm';
import SystemAgentForm from './features/SystemAgentForm';

const Page = () => {
  const { t } = useTranslation('setting');
  const { enableKnowledgeBase } = useServerConfigStore(featureFlagsSelectors);
  return (
    <>
      <SettingHeader title={t('tab.agent')} />
      <DefaultAgentForm />
      <SystemAgentForm systemAgentKey="topic" />
      <SystemAgentForm systemAgentKey="generationTopic" />
      <SystemAgentForm systemAgentKey="translation" />
      <SystemAgentForm systemAgentKey="historyCompress" />
      <SystemAgentForm systemAgentKey="agentMeta" />
      {enableKnowledgeBase && (
        <SystemAgentForm
          allowCustomPrompt
          allowDisable
          defaultPrompt={DEFAULT_REWRITE_QUERY}
          systemAgentKey="queryRewrite"
        />
      )}
    </>
  );
};

export default Page;
