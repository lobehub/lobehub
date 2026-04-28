'use client';

import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import SystemAgentForm from './features/SystemAgentForm';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.agent')} />
      <SystemAgentForm systemAgentKey="topic" />
      <SystemAgentForm systemAgentKey="generationTopic" />
      <SystemAgentForm systemAgentKey="translation" />
      <SystemAgentForm systemAgentKey="historyCompress" />
      <SystemAgentForm systemAgentKey="agentMeta" />
      <SystemAgentForm allowDisable systemAgentKey="inputCompletion" />
      <SystemAgentForm allowDisable systemAgentKey="promptRewrite" />
    </>
  );
};

export default Page;
