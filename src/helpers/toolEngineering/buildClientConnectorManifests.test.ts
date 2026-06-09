import { describe, expect, it } from 'vitest';

import { ConnectorToolPermission } from '@/database/schemas';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

import { buildClientConnectorManifests } from './buildClientConnectorManifests';

const tool = (over: Partial<ConnectorWithTools['tools'][number]> = {}) =>
  ({
    crudType: 'read',
    description: 'does a thing',
    displayName: null,
    id: 't1',
    inputSchema: { properties: {}, type: 'object' },
    permission: ConnectorToolPermission.auto,
    toolName: 'do_thing',
    userConnectorId: 'c1',
    ...over,
  }) as ConnectorWithTools['tools'][number];

const connector = (over: Partial<ConnectorWithTools> = {}): ConnectorWithTools =>
  ({
    credentials: null,
    id: 'c1',
    identifier: 'my-conn',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
    metadata: null,
    name: 'My Connector',
    sourceType: 'custom',
    status: 'connected',
    tools: [tool()],
    ...over,
  }) as ConnectorWithTools;

describe('buildClientConnectorManifests', () => {
  it('excludes disabled connectors', () => {
    expect(buildClientConnectorManifests([connector({ isEnabled: false })])).toEqual([]);
  });

  it('excludes connectors with no synced tools', () => {
    expect(buildClientConnectorManifests([connector({ tools: [] })])).toEqual([]);
  });

  it('maps auto permission to no humanIntervention', () => {
    const [m] = buildClientConnectorManifests([connector()]);
    expect(m.identifier).toBe('my-conn');
    expect(m.type).toBe('mcp');
    expect(m.api[0].humanIntervention).toBeUndefined();
  });

  it('maps needs_approval to humanIntervention required', () => {
    const [m] = buildClientConnectorManifests([
      connector({ tools: [tool({ permission: ConnectorToolPermission.needs_approval })] }),
    ]);
    expect(m.api[0].humanIntervention).toBe('required');
  });

  it('keeps disabled tools but with a blocking description', () => {
    const [m] = buildClientConnectorManifests([
      connector({ tools: [tool({ permission: ConnectorToolPermission.disabled })] }),
    ]);
    // still present so the AI knows it exists, but told not to call it
    expect(m.api).toHaveLength(1);
    expect(m.api[0].description).toContain('[TOOL DISABLED]');
    expect(m.api[0].humanIntervention).toBe('required');
  });
});
