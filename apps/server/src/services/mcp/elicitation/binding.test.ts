import { describe, expect, it } from 'vitest';

import { mcpConnectionBinding } from './binding';

describe('MCP continuation destination binding', () => {
  it('ignores display names, omitted properties, key order and rotating OAuth tokens', () => {
    expect(
      mcpConnectionBinding({
        type: 'http',
        url: 'https://example.com/mcp',
        name: 'slug',
        auth: { accessToken: 'old' },
      }),
    ).toBe(
      mcpConnectionBinding({
        name: 'Friendly name',
        url: 'https://example.com/mcp',
        type: 'http',
        headers: undefined,
        auth: { accessToken: 'new' },
      }),
    );
  });
  it('rejects a different endpoint, command, environment or custom tenant header', () => {
    const base = { type: 'http', url: 'https://example.com/mcp', headers: { tenant: 'alice' } };
    expect(mcpConnectionBinding(base)).not.toBe(
      mcpConnectionBinding({ ...base, url: 'https://other.example/mcp' }),
    );
    expect(mcpConnectionBinding(base)).not.toBe(
      mcpConnectionBinding({ ...base, headers: { tenant: 'bob' } }),
    );
    expect(mcpConnectionBinding({ type: 'stdio', command: 'a', env: { USER: 'alice' } })).not.toBe(
      mcpConnectionBinding({ type: 'stdio', command: 'a', env: { USER: 'bob' } }),
    );
  });
});
