// Fixture: every specifier is an inline `type`, so the whole import is erased.
import { memo } from 'react';

import { type SidebarAgentItem } from '@/database/repositories/home';
import { type GetGenerationStatusResult } from '@/server/routers/lambda/generation';

interface AgentRowProps {
  agent: SidebarAgentItem;
  status?: GetGenerationStatusResult;
}

const AgentRow = memo<AgentRowProps>(({ agent, status }) => (
  <div>
    {agent.title}
    {status ? ` · ${status.status}` : null}
  </div>
));

export default AgentRow;
