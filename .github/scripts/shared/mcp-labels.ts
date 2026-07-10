export const MCP_FEATURE_LABEL = 'feature:mcp';
export const MCP_SUBMISSION_LABEL = 'mcp:submission';
export const MCP_MANUAL_REVIEW_LABEL = 'mcp:manual-review';
export const MCP_RESCAN_LABEL = 'mcp:rescan';
export const MCP_TRIGGER_TRIAGE_LABEL = 'trigger:mcp-triage';

export const MCP_LEGACY_SUBMISSION_LABEL = 'mcp-submission';
export const MCP_LEGACY_REMOTE_LABEL = 'mcp:remote';

export const MCP_LABEL_COLORS = {
  feature: 'faf9f6',
  manualReview: 'fbca04',
  rescan: '1d76db',
  submission: 'c5def5',
  triggerTriage: 'ededed',
} as const;

export const MCP_LABEL_DESCRIPTIONS = {
  feature:
    'MCP-related issues across connectors, tools, marketplace, runtime, and desktop integration',
  manualReview:
    'MCP submission cannot be resolved by the self-service CLI; maintainer review required',
  rescan:
    'Existing MCP marketplace listing needs a rescan/refresh; maintainer or automation action required',
  submission: 'MCP marketplace listing submission handled by the MCP submission workflow',
  triggerTriage: 'Manually trigger MCP submission handling',
} as const;
