'use client';

import AgentUserTools from '@/features/ProfileEditor/AgentUserTools';

/**
 * Renders the Agent's tools in its profile.
 *
 * Use when:
 * - Editing Agent connectors and pinned user tools
 *
 * Expects:
 * - The active Agent context is mounted
 *
 * Returns:
 * - Web-compatible tools, including eligible hidden tools
 */
const AgentTool = () => <AgentUserTools filterAvailableInWeb useAllMetaList />;

export default AgentTool;
