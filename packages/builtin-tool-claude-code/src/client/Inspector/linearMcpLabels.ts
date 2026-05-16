// Pure label utilities for Linear MCP tool calls. Kept free of antd-style /
// React / lucide imports so the workflow-summary path can pull
// `formatLinearMcpShortLabel` without dragging the inspector component
// (and its `keyframes`-using style modules) into test transitively.

export const LINEAR_MCP_PREFIX = 'mcp__claude_ai_Linear__';

// Mirrors the wire names CC emits for the claude.ai Linear MCP server.
export const LINEAR_MCP_TOOL_NAMES = [
  'create_attachment',
  'create_attachment_from_upload',
  'create_issue_label',
  'delete_attachment',
  'delete_comment',
  'delete_customer',
  'delete_customer_need',
  'delete_status_update',
  'extract_images',
  'get_attachment',
  'get_diff',
  'get_diff_threads',
  'get_document',
  'get_initiative',
  'get_issue',
  'get_issue_status',
  'get_milestone',
  'get_project',
  'get_status_updates',
  'get_team',
  'get_user',
  'list_comments',
  'list_customers',
  'list_cycles',
  'list_diffs',
  'list_documents',
  'list_initiatives',
  'list_issue_labels',
  'list_issue_statuses',
  'list_issues',
  'list_milestones',
  'list_project_labels',
  'list_projects',
  'list_teams',
  'list_users',
  'prepare_attachment_upload',
  'save_comment',
  'save_customer',
  'save_customer_need',
  'save_document',
  'save_initiative',
  'save_issue',
  'save_milestone',
  'save_project',
  'save_status_update',
  'search_documentation',
] as const;

// Multi-word suffixes a naive split would mangle.
const NOUN_OVERRIDES: Record<string, string> = {
  customer_need: 'customer need',
  diff_threads: 'diff threads',
  documentation: 'docs',
  issue_label: 'issue label',
  issue_labels: 'issue labels',
  issue_status: 'issue status',
  issue_statuses: 'issue statuses',
  project_labels: 'project labels',
  status_update: 'status update',
  status_updates: 'status updates',
};

export interface ParsedTool {
  noun: string;
  verb: 'get' | 'list' | 'save' | 'create' | 'delete' | 'search' | 'extract' | 'prepare' | 'other';
}

export const parseToolName = (apiName: string): ParsedTool => {
  const suffix = apiName.startsWith(LINEAR_MCP_PREFIX)
    ? apiName.slice(LINEAR_MCP_PREFIX.length)
    : apiName;

  if (suffix === 'extract_images') return { noun: 'images', verb: 'extract' };
  if (suffix === 'prepare_attachment_upload') return { noun: 'attachment upload', verb: 'prepare' };
  if (suffix === 'search_documentation') return { noun: 'docs', verb: 'search' };

  const underscoreIdx = suffix.indexOf('_');
  if (underscoreIdx <= 0) return { noun: suffix, verb: 'other' };

  const head = suffix.slice(0, underscoreIdx);
  const tail = suffix.slice(underscoreIdx + 1);
  const noun = NOUN_OVERRIDES[tail] ?? tail.replaceAll('_', ' ');

  switch (head) {
    case 'get':
    case 'list':
    case 'save':
    case 'create':
    case 'delete': {
      return { noun, verb: head };
    }
    default: {
      return { noun: suffix.replaceAll('_', ' '), verb: 'other' };
    }
  }
};

export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Args-free verb label; the collapsed-summary view has no runtime args, so
// `save_*` stays "Save {noun}" rather than guessing Create vs Update.
export const staticLabelFor = (parsed: ParsedTool): string => {
  const { verb, noun } = parsed;
  switch (verb) {
    case 'extract': {
      return 'Extract images';
    }
    case 'prepare': {
      return 'Prepare attachment upload';
    }
    case 'search': {
      return 'Search docs';
    }
    case 'other': {
      return capitalize(noun);
    }
    default: {
      return `${capitalize(verb)} ${noun}`;
    }
  }
};

export const formatLinearMcpShortLabel = (apiName: string): string | null => {
  if (!apiName.startsWith(LINEAR_MCP_PREFIX)) return null;
  return `Linear · ${staticLabelFor(parseToolName(apiName))}`;
};
