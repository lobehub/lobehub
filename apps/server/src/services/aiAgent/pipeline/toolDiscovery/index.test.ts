import type { LobeToolManifest } from '@lobechat/context-engine';
import { ON_DEMAND_BOOTSTRAP_MANIFESTS } from '@lobechat/context-engine/onDemand';
import { describe, expect, it } from 'vitest';

import { buildOnDemandDiscoveryPool } from './index';

const manifest = (
  identifier: string,
  options: {
    api?: Array<{ description?: string; name: string }>;
    description?: string;
    mcpParams?: Record<string, unknown>;
    systemRole?: string;
    type?: LobeToolManifest['type'];
  } = {},
): LobeToolManifest =>
  ({
    api: (options.api ?? [{ name: 'run' }]).map((api) => ({
      description: api.description ?? `Run ${api.name}`,
      name: api.name,
      parameters: {
        properties: {
          input: { description: 'Exact native input', type: 'string' },
        },
        required: ['input'],
        type: 'object',
      },
    })),
    identifier,
    meta: {
      avatar: '🧰',
      description: options.description ?? `${identifier} capability`,
      title: `${identifier} title`,
    },
    ...(options.mcpParams && { mcpParams: options.mcpParams }),
    ...(options.systemRole && { systemRole: options.systemRole }),
    type: options.type ?? 'default',
  }) as LobeToolManifest;

describe('buildOnDemandDiscoveryPool', () => {
  it('keeps only reachable, allowed, non-bootstrap capabilities and drops disabled APIs', () => {
    const manifestMap: Record<string, LobeToolManifest> = {
      [ON_DEMAND_BOOTSTRAP_MANIFESTS[0].identifier]: ON_DEMAND_BOOTSTRAP_MANIFESTS[0],
      'cold-tool': manifest('cold-tool', {
        api: [
          { name: 'allowed' },
          { description: '[TOOL DISABLED] blocked by connector policy', name: 'blocked' },
          { description: '[TOOL DISABLED] also blocked', name: 'blocked_too' },
        ],
      }),
      'disabled-tool': manifest('disabled-tool', {
        api: [{ description: '[TOOL DISABLED] every API is blocked', name: 'blocked' }],
      }),
      'lobe-local-system': manifest('lobe-local-system'),
      'offline-stdio': manifest('offline-stdio', {
        mcpParams: { type: 'stdio' },
        type: 'mcp',
      }),
      'malformed': {
        ...manifest('malformed'),
        identifier: 'different-native-identifier',
      },
      'unauthorized-tool': manifest('unauthorized-tool'),
    };

    const pool = buildOnDemandDiscoveryPool({
      allowedIdentifiers: new Set([
        'cold-tool',
        'disabled-tool',
        'lobe-local-system',
        'malformed',
        'offline-stdio',
        ON_DEMAND_BOOTSTRAP_MANIFESTS[0].identifier,
      ]),
      canUseDevice: false,
      deviceOnline: false,
      gatewayConfigured: true,
      manifestMap,
    });

    expect(pool.cards.map((card) => card.identifier)).toEqual(['cold-tool']);
    expect(pool.bundles['cold-tool'].manifest.api.map((api) => api.name)).toEqual(['allowed']);
    expect(pool.bundles['cold-tool'].manual.content).not.toContain('blocked by connector policy');
    expect(pool.bundles['cold-tool'].manual.content).toContain('Exact native input');
  });

  it('stores the full native schema, manual, source, execution environment, and identity', () => {
    const longManual = `Full system role ${'detail '.repeat(2_000)}END`;
    const pool = buildOnDemandDiscoveryPool({
      agentId: 'agent-1',
      canUseDevice: true,
      deviceOnline: true,
      executorMap: { 'client-release': 'client' },
      gatewayConfigured: true,
      manifestMap: {
        'client-release': manifest('client-release', {
          api: [{ name: 'release' }, { name: 'rollback' }],
          systemRole: longManual,
        }),
      },
      sourceMap: { 'client-release': 'client' },
      workspaceId: 'workspace-1',
    });

    const card = pool.cards[0];
    const bundle = pool.bundles['client-release'];

    expect(card).toMatchObject({
      capability: 'client-release capability',
      executionEnvironment: 'client',
      identifier: 'client-release',
      name: 'client-release title',
      source: 'plugin',
      version: bundle.version,
      hash: bundle.hash,
    });
    expect(bundle.manual.content).toContain(longManual);
    expect(bundle.manual.content).toContain('"name": "release"');
    expect(bundle.manual.content).toContain('"name": "rollback"');
    expect(bundle.execution).toMatchObject({
      environment: 'client',
      transport: 'builtin-native',
    });
    expect(bundle.permissions.sharedAuthorizations).toEqual([
      { authorizationId: 'workspace:workspace-1', scopes: ['tool:execute'] },
    ]);
  });

  it('fails closed for device tools when the run has no device execution target', () => {
    const pool = buildOnDemandDiscoveryPool({
      canUseDevice: true,
      deviceOnline: false,
      executionTarget: 'none',
      gatewayConfigured: false,
      manifestMap: {
        'lobe-local-system': manifest('lobe-local-system'),
        'server-tool': manifest('server-tool'),
      },
    });

    expect(pool.cards.map((card) => card.identifier)).toEqual(['server-tool']);
    expect(pool.bundles['lobe-local-system']).toBeUndefined();
  });

  it('fails closed for device tools and stdio MCP when the gateway has no online device', () => {
    const pool = buildOnDemandDiscoveryPool({
      canUseDevice: true,
      deviceOnline: false,
      executionTarget: 'auto',
      gatewayConfigured: true,
      manifestMap: {
        'lobe-local-system': manifest('lobe-local-system'),
        'offline-stdio': manifest('offline-stdio', {
          mcpParams: { type: 'stdio' },
          type: 'mcp',
        }),
        'server-tool': manifest('server-tool'),
      },
    });

    expect(pool.cards.map((card) => card.identifier)).toEqual(['server-tool']);
  });
});
