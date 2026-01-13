'use client';

import { AgentTool as SharedAgentTool } from '@/features/ProfileEditor';

/**
 * AgentTool for group profile editor
 * - Uses default settings (no web browsing, no filterAvailableInWeb, uses metaList)
 */
const AgentTool = () => {
  return <SharedAgentTool />;
};

export default AgentTool;
