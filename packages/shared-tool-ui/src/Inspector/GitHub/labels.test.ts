import { describe, expect, it } from 'vitest';

import { getGitHubToolSuffix, isGitHubMcpApiName, parseGitHubToolName } from './labels';

describe('GitHub label helpers', () => {
  it('normalizes MCP and Codex Apps GitHub tool names', () => {
    expect(getGitHubToolSuffix('mcp__codex_apps__github__github_create_pull_request')).toBe(
      'create_pull_request',
    );
    expect(getGitHubToolSuffix('github_update_issue')).toBe('update_issue');
    expect(getGitHubToolSuffix('server_github_get_repository')).toBe('get_repository');
    expect(getGitHubToolSuffix('_create_branch')).toBe('create_branch');
  });

  it('detects only MCP names backed by a GitHub server segment', () => {
    expect(isGitHubMcpApiName('mcp__codex_apps__github__github_create_pull_request')).toBe(true);
    expect(isGitHubMcpApiName('mcp__linear-server__get_issue')).toBe(false);
    expect(isGitHubMcpApiName('github_create_pull_request')).toBe(false);
  });

  it('parses GitHub suffixes into verb and noun labels', () => {
    expect(parseGitHubToolName('github_create_pull_request')).toEqual({
      noun: 'pull request',
      verb: 'create',
    });
    expect(parseGitHubToolName('search_repositories')).toEqual({
      noun: 'repositories',
      verb: 'search',
    });
  });
});
