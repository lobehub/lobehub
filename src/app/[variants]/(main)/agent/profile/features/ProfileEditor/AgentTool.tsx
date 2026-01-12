'use client';

import { AgentTool as SharedAgentTool } from '@/features/ProfileEditor';

/**
 * AgentTool for agent profile editor
 * - showWebBrowsing: Agent profile supports web browsing toggle
 * - filterAvailableInWeb: Filter out desktop-only tools in web version
 * - useAllMetaList: Use allMetaList to include hidden tools
 */
const AgentTool = () => {
  return <SharedAgentTool filterAvailableInWeb showWebBrowsing useAllMetaList />;
};

export default AgentTool;
