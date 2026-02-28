'use client';

import { memo } from 'react';

import PageTitle from '@/components/PageTitle';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const agentTitle = useAgentStore(agentSelectors.currentAgentTitle);

  const topicTitle = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.title);
  return <PageTitle title={[topicTitle, agentTitle].filter(Boolean).join(' · ')} />;
});

export default Title;
