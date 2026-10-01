// Fixture: remote read inside useEffect copied into useState.
import { memo, useEffect, useState } from 'react';

import { agentService } from '@/services/agent';

const AgentTitle = memo<{ id: string }>(({ id }) => {
  const [title, setTitle] = useState<string>('');

  // alint-expect
  useEffect(() => {
    agentService.getAgentConfig(id).then((config) => setTitle(config.title ?? ''));
  }, [id]);

  return <span>{title}</span>;
});

export default AgentTitle;
