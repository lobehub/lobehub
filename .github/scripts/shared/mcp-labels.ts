export const MCP_FEATURE_LABEL = 'feature:mcp';
export const MCP_SUBMISSION_LABEL = 'mcp:submission';
export const MCP_TRIGGER_TRIAGE_LABEL = 'trigger:mcp-triage';

/** @deprecated Legacy labels kept only so old issues still skip dedupe. */
export const MCP_LEGACY_SUBMISSION_LABEL = 'mcp-submission';
/** @deprecated */
export const MCP_LEGACY_REMOTE_LABEL = 'mcp:remote';
/** @deprecated Removed in favor of mcp:submission */
export const MCP_LEGACY_MANUAL_REVIEW_LABEL = 'mcp:manual-review';
/** @deprecated Removed in favor of mcp:submission */
export const MCP_LEGACY_RESCAN_LABEL = 'mcp:rescan';

export const MCP_LABEL_COLORS = {
  feature: 'faf9f6',
  submission: 'c5def5',
  triggerTriage: 'ededed',
} as const;

export const MCP_LABEL_DESCRIPTIONS = {
  feature:
    'MCP-related issues across connectors, tools, marketplace, runtime, and desktop integration',
  submission:
    'MCP marketplace listing request (new listing, refresh, or rescan) redirected to self-service CLI',
  triggerTriage: 'Manually trigger MCP submission handling',
} as const;
