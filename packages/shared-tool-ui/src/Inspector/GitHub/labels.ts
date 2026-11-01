// Pure label utilities for GitHub tool calls. Used by Codex MCP routing and
// direct GitHub builtin surfaces without pulling React/style modules into tests.

export const GITHUB_TOOL_NAMES = [
  'add_comment',
  'check_pull_request_mergeability',
  'close_issue',
  'close_pull_request',
  'compare_commits',
  'create_branch',
  'create_issue',
  'create_pull_request',
  'delete_branch',
  'fork_repository',
  'get_branch',
  'get_commit',
  'get_file',
  'get_issue',
  'get_pull_request',
  'get_repository',
  'list_branches',
  'list_commits',
  'list_issues',
  'list_pull_requests',
  'list_repositories',
  'merge_pull_request',
  'reopen_issue',
  'reopen_pull_request',
  'request_review',
  'search_code',
  'search_issues',
  'search_pull_requests',
  'search_repositories',
  'update_issue',
  'update_pull_request',
] as const;

const NOUN_OVERRIDES: Record<string, string> = {
  branch: 'branch',
  branches: 'branches',
  code: 'code',
  commit: 'commit',
  commits: 'commits',
  file: 'file',
  issue: 'issue',
  issues: 'issues',
  pull_request: 'pull request',
  pull_requests: 'pull requests',
  repositories: 'repositories',
  repository: 'repository',
  review: 'review',
};

export interface ParsedGitHubTool {
  noun: string;
  verb:
    | 'add'
    | 'check'
    | 'close'
    | 'compare'
    | 'create'
    | 'delete'
    | 'fork'
    | 'get'
    | 'list'
    | 'merge'
    | 'reopen'
    | 'request'
    | 'search'
    | 'update'
    | 'other';
}

const isGitHubMcpServerSegment = (segment: string) =>
  segment
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .includes('github');

const toSnakeCase = (value: string) =>
  value
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[-\s]+/g, '_')
    .toLowerCase();

const stripGitHubToolPrefixes = (value: string): string => {
  let suffix = toSnakeCase(value.trim());
  let changed = true;

  while (changed) {
    changed = false;

    if (suffix.startsWith('server_github_')) {
      suffix = suffix.slice('server_github_'.length);
      changed = true;
    }

    if (suffix.startsWith('github_')) {
      suffix = suffix.slice('github_'.length);
      changed = true;
    }

    while (suffix.startsWith('_')) {
      suffix = suffix.slice(1);
      changed = true;
    }
  }

  return suffix;
};

export const getGitHubToolSuffix = (apiName: string): string => {
  const parts = apiName.split('__');
  const rawSuffix =
    parts.length >= 3 && parts[0] === 'mcp' && parts.slice(1, -1).some(isGitHubMcpServerSegment)
      ? parts.at(-1) || apiName
      : apiName;

  return stripGitHubToolPrefixes(rawSuffix);
};

export const isGitHubMcpApiName = (apiName: string): boolean => {
  const parts = apiName.split('__');
  return (
    parts.length >= 3 && parts[0] === 'mcp' && parts.slice(1, -1).some(isGitHubMcpServerSegment)
  );
};

export const parseGitHubToolName = (apiName: string): ParsedGitHubTool => {
  const suffix = getGitHubToolSuffix(apiName);
  const underscoreIdx = suffix.indexOf('_');
  if (underscoreIdx <= 0) return { noun: suffix, verb: 'other' };

  const head = suffix.slice(0, underscoreIdx);
  const tail = suffix.slice(underscoreIdx + 1);
  const noun = NOUN_OVERRIDES[tail] ?? tail.replaceAll('_', ' ');

  switch (head) {
    case 'add':
    case 'check':
    case 'close':
    case 'compare':
    case 'create':
    case 'delete':
    case 'fork':
    case 'get':
    case 'list':
    case 'merge':
    case 'reopen':
    case 'request':
    case 'search':
    case 'update': {
      return { noun, verb: head };
    }
    default: {
      return { noun: suffix.replaceAll('_', ' '), verb: 'other' };
    }
  }
};

export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const staticGitHubLabelFor = (parsed: ParsedGitHubTool): string => {
  const { verb, noun } = parsed;
  if (verb === 'other') return capitalize(noun);
  return `${capitalize(verb)} ${noun}`;
};
