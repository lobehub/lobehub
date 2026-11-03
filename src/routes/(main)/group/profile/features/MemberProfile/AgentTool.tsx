'use client';

import { AgentTool as SharedAgentTool } from '@/features/ProfileEditor';
import { useGroupProfileStore } from '@/store/groupProfile';

/**
 * AgentTool for group profile editor
 * - filterAvailableInWeb: Filter out desktop-only tools in web version
 * - useAllMetaList: Include eligible hidden tools
 * - Passes agentId from group profile store to display the correct member's plugins
 */
const AgentTool = () => {
  const agentId = useGroupProfileStore((s) => s.activeTabId);
  return <SharedAgentTool filterAvailableInWeb useAllMetaList agentId={agentId} />;
};

export default AgentTool;
