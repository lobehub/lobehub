'use client';

import { useParams } from 'react-router';

import AgentAutomations from '@/features/AgentAutomations';

const AgentAutomationsPage = () => {
  const { aid } = useParams<{ aid?: string }>();

  return aid ? <AgentAutomations agentId={aid} /> : null;
};

export default AgentAutomationsPage;
