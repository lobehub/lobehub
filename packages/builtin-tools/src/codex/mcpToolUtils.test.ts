import { describe, expect, it } from 'vitest';

import { getCodexLinearMcpApiName, getMcpInputRecord } from './mcpToolUtils';

describe('getCodexLinearMcpApiName', () => {
  it('maps Codex Apps fetch calls to entity-specific Linear APIs', () => {
    expect(
      getCodexLinearMcpApiName({ input: { id: 'issue:TEST-0000' }, toolName: 'linear_fetch' }),
    ).toBe('get_issue');
    expect(
      getCodexLinearMcpApiName({ input: { id: 'project:Desktop' }, toolName: 'linear_fetch' }),
    ).toBe('get_project');
    expect(
      getCodexLinearMcpApiName({ input: { id: 'initiative:AI' }, toolName: 'linear_fetch' }),
    ).toBe('get_initiative');
    expect(
      getCodexLinearMcpApiName({
        input: { id: 'document:agent-runtime' },
        toolName: 'linear_fetch',
      }),
    ).toBe('get_document');
  });

  it('keeps generic Codex Apps Linear search and unknown fetch names renderable', () => {
    expect(
      getCodexLinearMcpApiName({
        input: { query: 'agent runtime' },
        toolName: 'linear_search',
      }),
    ).toBe('search');
    expect(
      getCodexLinearMcpApiName({ input: { id: 'unknown:123' }, toolName: 'linear_fetch' }),
    ).toBe('fetch');
  });

  it('normalizes MCP-prefixed and underscored Linear tool names', () => {
    expect(getCodexLinearMcpApiName({ toolName: '_get_issue' })).toBe('get_issue');
    expect(getCodexLinearMcpApiName({ toolName: 'linear__get_issue' })).toBe('get_issue');
    expect(getCodexLinearMcpApiName({ toolName: 'server_linear_get_issue' })).toBe('get_issue');
  });

  it('treats bare issue identifiers as issue fetch calls', () => {
    expect(
      getCodexLinearMcpApiName({ input: { id: 'TEST-0000' }, toolName: 'linear_fetch' }),
    ).toBe('get_issue');
  });

  it('does not treat generic fetch or search from other MCP servers as Linear', () => {
    expect(
      getCodexLinearMcpApiName({
        input: { query: 'agent runtime' },
        server: 'node_repl',
        toolName: 'search',
      }),
    ).toBe('');
    expect(
      getCodexLinearMcpApiName({
        input: { id: 'TEST-0000' },
        server: 'github',
        toolName: 'fetch',
      }),
    ).toBe('');
  });

  it('allows bare fetch only when the input has a Linear entity prefix', () => {
    expect(
      getCodexLinearMcpApiName({
        input: { id: 'issue:TEST-0000' },
        server: 'node_repl',
        toolName: 'fetch',
      }),
    ).toBe('get_issue');
  });

  it('allows generic fetch or search from a Linear server', () => {
    expect(
      getCodexLinearMcpApiName({
        input: { query: 'agent runtime' },
        server: 'mcp__codex_apps__linear',
        toolName: 'search',
      }),
    ).toBe('search');
    expect(
      getCodexLinearMcpApiName({
        input: { id: 'unknown:123' },
        server: 'mcp__codex_apps__linear',
        toolName: 'fetch',
      }),
    ).toBe('fetch');
  });
});

describe('getMcpInputRecord', () => {
  it('parses JSON string MCP arguments', () => {
    expect(getMcpInputRecord({ arguments: '{"id":"issue:TEST-0000"}' })).toEqual({
      id: 'issue:TEST-0000',
    });
  });
});
