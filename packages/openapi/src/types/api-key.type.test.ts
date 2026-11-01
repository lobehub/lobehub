import { describe, expect, it } from 'vitest';

import { CreateApiKeyRequestSchema, UpdateApiKeyRequestSchema } from './api-key.type';

describe('API key management request schemas', () => {
  it('normalizes explicit full access and rejects unknown scopes', () => {
    expect(
      CreateApiKeyRequestSchema.parse({ name: 'SDK', scopes: ['*', 'agent:read'] }).scopes,
    ).toEqual(['*']);
    expect(() =>
      CreateApiKeyRequestSchema.parse({ name: 'SDK', scopes: ['billing:write'] }),
    ).toThrow('Unknown API key scope');
  });

  it('accepts the MCP and usage scopes exposed by the public API', () => {
    expect(
      CreateApiKeyRequestSchema.parse({
        name: 'Operations',
        scopes: ['mcp:read', 'mcp:write', 'usage:read'],
      }).scopes,
    ).toEqual(['mcp:read', 'mcp:write', 'usage:read']);
  });

  it('accepts ISO expiration and rejects empty updates', () => {
    expect(
      CreateApiKeyRequestSchema.parse({
        expiresAt: '2027-01-01T00:00:00.000Z',
        name: 'Expiring',
      }).expiresAt,
    ).toBeInstanceOf(Date);
    expect(UpdateApiKeyRequestSchema.safeParse({}).success).toBe(false);
  });

  it('keeps scopes immutable after creation', () => {
    expect(UpdateApiKeyRequestSchema.safeParse({ scopes: ['agent:read'] }).success).toBe(false);
  });
});
