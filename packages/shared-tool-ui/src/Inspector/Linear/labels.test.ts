import { describe, expect, it } from 'vitest';

import { getLinearToolSuffix, isLinearMcpApiName, parseToolName } from './labels';

describe('Linear label helpers', () => {
  it('normalizes Claude Code and generic Linear MCP tool names', () => {
    expect(getLinearToolSuffix('mcp__claude_ai_Linear__get_issue')).toBe('get_issue');
    expect(getLinearToolSuffix('mcp__linear-server__save_issue')).toBe('save_issue');
    expect(getLinearToolSuffix('mcp__linear__list_issues')).toBe('list_issues');
  });

  it('detects only MCP names backed by a Linear server segment', () => {
    expect(isLinearMcpApiName('mcp__linear-server__get_issue')).toBe(true);
    expect(isLinearMcpApiName('mcp__github__get_issue')).toBe(false);
    expect(isLinearMcpApiName('get_issue')).toBe(false);
  });

  it('parses generic Linear MCP suffixes into verb and noun labels', () => {
    expect(parseToolName('mcp__linear-server__save_issue')).toEqual({
      noun: 'issue',
      verb: 'save',
    });
  });
});
