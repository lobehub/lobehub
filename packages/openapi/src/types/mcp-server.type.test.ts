import { describe, expect, it } from 'vitest';

import { CreateMcpServerRequestSchema, UpdateMcpServerRequestSchema } from './mcp-server.type';

describe('MCP server request schemas', () => {
  it('accepts a remote HTTP server with write-only credentials', () => {
    const parsed = CreateMcpServerRequestSchema.parse({
      credentials: { token: 'secret', type: 'bearer' },
      identifier: 'linear-mcp',
      name: 'Linear',
      serverUrl: 'https://mcp.example.com/server',
    });

    expect(parsed.credentials).toEqual({ token: 'secret', type: 'bearer' });
  });

  it('rejects non-HTTP transports and credentials embedded in URLs', () => {
    expect(
      CreateMcpServerRequestSchema.safeParse({
        identifier: 'stdio',
        name: 'stdio',
        serverUrl: 'file:///tmp/server',
      }).success,
    ).toBe(false);
    expect(
      CreateMcpServerRequestSchema.safeParse({
        identifier: 'embedded-secret',
        name: 'unsafe',
        serverUrl: 'https://user:password@example.com/mcp',
      }).success,
    ).toBe(false);
  });

  it('requires a non-empty update and supports explicit credential removal', () => {
    expect(UpdateMcpServerRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateMcpServerRequestSchema.safeParse({ credentials: null }).success).toBe(true);
  });
});
