import { describe, expect, it } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';

import { hasSupportedEventConnector } from './eventConnectors';

const connector = (patch: Partial<DecryptedConnector> = {}): DecryptedConnector =>
  ({
    agentId: null,
    avatar: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    accessedAt: new Date(),
    credentials: null,
    description: null,
    id: 'connector',
    identifier: 'linear',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://example.com/mcp',
    metadata: { capabilities: { events: { supported: true } } },
    name: 'Linear',
    userId: 'user',
    workspaceId: null,
    ...patch,
  }) as DecryptedConnector;

describe('event connector discovery', () => {
  it('detects an enabled HTTP connector with events capability', () => {
    expect(hasSupportedEventConnector([connector()])).toBe(true);
    expect(hasSupportedEventConnector([])).toBe(false);
  });

  it.each([
    { isEnabled: false },
    { mcpConnectionType: 'stdio' as const },
    { mcpServerUrl: null },
    { metadata: {} },
    { metadata: { capabilities: { events: { supported: false } } } },
  ])('rejects non-event or unavailable connectors: %j', (patch) => {
    expect(hasSupportedEventConnector([connector(patch)])).toBe(false);
  });
});
