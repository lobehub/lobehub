'use client';

import { AgentTool as SharedAgentTool } from '@/features/ProfileEditor';
import { useGroupProfileStore } from '@/store/groupProfile';

/**
 * AgentTool for group profile editor
 * - Uses default settings (no web browsing, no filterAvailableInWeb, uses metaList)
 * - Passes agentId from group profile store to display the correct member's plugins
 */
const AgentTool = () => {
  const agentId = useGroupProfileStore((s) => s.activeTabId);
  return <SharedAgentTool agentId={agentId} />;
};

export default AgentTool;
