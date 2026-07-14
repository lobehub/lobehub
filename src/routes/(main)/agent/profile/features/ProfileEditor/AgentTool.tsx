'use client';

import AgentUserTools from '@/features/ProfileEditor/AgentUserTools';

/**
 * Tools area for the agent profile editor — an Agent Tools / User Tools tabbed
 * view (agent-scoped connectors vs the user's pinned tools).
 * - showWebBrowsing: Agent profile supports web browsing toggle
 * - filterAvailableInWeb: Filter out desktop-only tools in web version
 * - useAllMetaList: Use allMetaList to include hidden tools
 */
const AgentTool = () => {
  return <AgentUserTools filterAvailableInWeb showWebBrowsing useAllMetaList />;
};

export default AgentTool;
