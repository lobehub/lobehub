import { memo } from 'react';

import { useAgentGroupStore } from '@/store/agentGroup';

const Title = memo(() => {
  useAgentGroupStore((s) => s.activeThreadAgentId);
  return <span>DM</span>;
});

export default Title;
