// Fixture: the same read through the SWR path.
import { memo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { agentService } from '@/services/agent';

const AgentTitle = memo<{ id: string }>(({ id }) => {
  const { data } = useClientDataSWR(['agent-config', id], () => agentService.getAgentConfig(id));

  return <span>{data?.title ?? ''}</span>;
});

export default AgentTitle;
