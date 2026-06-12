import { describe, expect, it } from 'vitest';

import { getCodexLinearMcpApiName, getMcpInputRecord } from './mcpToolUtils';

describe('getCodexLinearMcpApiName', () => {
  it('maps Codex Apps fetch calls to entity-specific Linear APIs', () => {
    expect(getCodexLinearMcpApiName('linear_fetch', { id: 'issue:LOBE-10205' })).toBe(
      'get_issue',
    );
    expect(getCodexLinearMcpApiName('linear_fetch', { id: 'project:Desktop' })).toBe(
      'get_project',
    );
    expect(getCodexLinearMcpApiName('linear_fetch', { id: 'initiative:AI' })).toBe(
      'get_initiative',
    );
    expect(getCodexLinearMcpApiName('linear_fetch', { id: 'document:agent-runtime' })).toBe(
      'get_document',
    );
  });

  it('keeps generic Codex Apps Linear search and unknown fetch names renderable', () => {
    expect(getCodexLinearMcpApiName('linear_search', { query: 'agent runtime' })).toBe('search');
    expect(getCodexLinearMcpApiName('linear_fetch', { id: 'unknown:123' })).toBe('fetch');
  });

  it('normalizes MCP-prefixed and underscored Linear tool names', () => {
    expect(getCodexLinearMcpApiName('_get_issue')).toBe('get_issue');
    expect(getCodexLinearMcpApiName('linear__get_issue')).toBe('get_issue');
    expect(getCodexLinearMcpApiName('server_linear_get_issue')).toBe('get_issue');
  });

  it('treats bare issue identifiers as issue fetch calls', () => {
    expect(getCodexLinearMcpApiName('linear_fetch', { id: 'LOBE-10205' })).toBe('get_issue');
  });
});

describe('getMcpInputRecord', () => {
  it('parses JSON string MCP arguments', () => {
    expect(getMcpInputRecord({ arguments: '{"id":"issue:LOBE-10205"}' })).toEqual({
      id: 'issue:LOBE-10205',
    });
  });
});
