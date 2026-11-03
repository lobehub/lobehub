'use client';

import AgentUserTools from '@/features/ProfileEditor/AgentUserTools';

/**
 * Tools area for the agent profile editor — an Agent Tools / User Tools tabbed
 * view (agent-scoped connectors vs the user's pinned tools).
 * - filterAvailableInWeb: Filter out desktop-only tools in web version
 * - useAllMetaList: Include eligible hidden tools
 */
const AgentTool = () => {
  return <AgentUserTools filterAvailableInWeb useAllMetaList />;
};

export default AgentTool;
