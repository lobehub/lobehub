'use client';

import { AgentTool as SharedAgentTool } from '@/features/ProfileEditor';
import { useGroupProfileStore } from '@/store/groupProfile';

/**
 * AgentTool for group profile editor
 * - showWebBrowsing: Group member profile supports web browsing toggle
 * - filterAvailableInWeb: Filter out desktop-only tools in web version
 * - useAllMetaList: Use allMetaList to include hidden tools
 * - Passes agentId from group profile store to display the correct member's plugins
 */
const AgentTool = () => {
  const agentId = useGroupProfileStore((s) => s.activeTabId);
  return <SharedAgentTool filterAvailableInWeb showWebBrowsing useAllMetaList agentId={agentId} />;
};

export default AgentTool;
