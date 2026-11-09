import { evalToolManifestSchema, redactEnvironmentConnections } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { mergeCaseEnvironment } from './caseEnvironment';

const contract = (identifier: string, description = 'Original read') => ({
  identifier,
  meta: { title: identifier },
  api: [{ name: 'read', description, parameters: { type: 'object' } }],
});

describe('frozen environment tool contracts', () => {
  it('a case overrides one contract without dropping the other inherited tools', () => {
    const shared = { toolManifests: { notion: contract('notion'), gmail: contract('gmail') } };
    const own = { toolManifests: { notion: contract('notion', 'Case-specific read') } };
    expect(mergeCaseEnvironment(shared, own)?.toolManifests).toEqual({
      notion: own.toolManifests.notion,
      gmail: shared.toolManifests.gmail,
    });
  });

  it('rejects ambiguous routing names and execution configuration in a model-facing contract', () => {
    expect(evalToolManifestSchema.safeParse(contract('notion____other')).success).toBe(false);
    expect(
      evalToolManifestSchema.safeParse({
        ...contract('notion'),
        api: [{ ...contract('notion').api[0], name: 'read____other' }],
      }).success,
    ).toBe(false);
    expect(
      evalToolManifestSchema.safeParse({
        ...contract('notion'),
        mcpParams: { url: 'https://mock.invalid' },
      }).success,
    ).toBe(false);
    expect(evalToolManifestSchema.safeParse(contract('notion')).success).toBe(true);
  });
});

describe('connections stored in a shared Environment', () => {
  const shared = {
    connections: {
      gmail: { credentials: 'sealed-secret', name: 'Gmail', url: 'https://mock.test/mcp/a/gmail' },
    },
    mock: { services: ['gmail', 'slack'] },
  };

  it('come from the shared Environment only, never from a case', () => {
    const merged = mergeCaseEnvironment(shared, {
      connections: { gmail: { credentials: 'case-secret', url: 'https://evil.test/mcp/a/gmail' } },
      mock: { services: ['gmail'] },
    });
    expect(merged?.connections).toEqual(shared.connections);
    expect(merged?.mock?.services).toEqual(['gmail']);
    expect(
      mergeCaseEnvironment(undefined, {
        connections: { gmail: { url: 'https://evil.test/mcp/a/gmail' } },
      })?.connections,
    ).toBeUndefined();
  });

  it('leave the server without their credentials', () => {
    const redacted = redactEnvironmentConnections(shared);
    expect(redacted.connections).toEqual({
      gmail: { hasCredentials: true, name: 'Gmail', url: 'https://mock.test/mcp/a/gmail' },
    });
    expect(JSON.stringify(redacted)).not.toContain('sealed-secret');
    expect(shared.connections.gmail.credentials).toBe('sealed-secret');
  });
});
