import { type LobeToolCustomPlugin } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildConnectorPayloadFromLegacy,
  executeLegacyMigrationSave,
} from './legacyPluginMigration';

/**
 * Fixtures are modeled on the 9 real-world `customParams.mcp` shapes observed
 * in the dev DB (2960 rows, 2026-06-16 survey). See
 * `memory/project_legacy_mcp_shapes.md` for the full distribution.
 */

const plugin = (overrides: Partial<LobeToolCustomPlugin> = {}): LobeToolCustomPlugin =>
  ({
    customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
    identifier: 'my-mcp',
    type: 'customPlugin',
    ...overrides,
  }) as LobeToolCustomPlugin;

describe('buildConnectorPayloadFromLegacy', () => {
  describe('Shape #1 — stdio with command/args/env (1159 prod rows)', () => {
    const stdioPlugin = plugin({
      customParams: {
        mcp: {
          args: ['--port', '9100'],
          command: '/usr/local/bin/my-server',
          env: { LOG_LEVEL: 'debug', TOKEN: '   ' /* whitespace → dropped */ },
          type: 'stdio',
        },
      },
      identifier: 'grok-with-tavily',
    });

    it('produces a stdio connector with no credentials', () => {
      const r = buildConnectorPayloadFromLegacy(stdioPlugin);
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.mcpConnectionType).toBe('stdio');
      expect(r.payload.mcpServerUrl).toBeUndefined();
      expect(r.payload.mcpStdioConfig).toEqual({
        args: ['--port', '9100'],
        command: '/usr/local/bin/my-server',
        env: { LOG_LEVEL: 'debug' }, // whitespace-only TOKEN dropped
      });
      expect(r.payload.credentials).toBeUndefined();
      expect(r.payload.sourceType).toBe('custom');
      expect(r.payload.identifier).toBe('grok-with-tavily');
    });

    it('preserves identifier (agentConfig.plugins references survive)', () => {
      const r = buildConnectorPayloadFromLegacy(stdioPlugin);
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.identifier).toBe(stdioPlugin.identifier);
    });
  });

  describe('Shape #2 — http + auth=none + url (879 prod rows)', () => {
    it('produces a plain http connector with no credentials', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            mcp: { auth: { type: 'none' }, type: 'http', url: 'http://10.9.16.224:9100/mcp' },
          },
          identifier: 'xc-mcp',
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.mcpConnectionType).toBe('http');
      expect(r.payload.mcpServerUrl).toBe('http://10.9.16.224:9100/mcp');
      expect(r.payload.credentials).toBeUndefined();
    });

    it('also covers the case the issue reporter hit (private IP HTTP)', () => {
      // This is the exact shape from #15674.
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { type: 'http', url: 'http://10.9.16.224:9100/mcp' } },
          identifier: 'dockpit',
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.mcpServerUrl).toBe('http://10.9.16.224:9100/mcp');
    });
  });

  describe('Shape #3 — http + auth=bearer + token (368 prod rows)', () => {
    it('produces a bearer credential', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            mcp: {
              auth: { token: '   sk-abc123  ', type: 'bearer' },
              type: 'http',
              url: 'https://mcp.example.com',
            },
          },
          identifier: 'mymcp',
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.credentials).toEqual({ token: 'sk-abc123', type: 'bearer' });
    });

    it('drops a bearer auth with an empty token (treats as no credential)', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            mcp: {
              auth: { token: '   ', type: 'bearer' },
              type: 'http',
              url: 'https://mcp.example.com',
            },
          },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.credentials).toBeUndefined();
    });
  });

  describe('Shape #4 — broken: no transport endpoint (227 prod rows)', () => {
    it('refuses to migrate plugins with no url and no command', () => {
      // Real prod identifiers: olyns_recycling_stats, plugin-vectorize-retrieval, etc.
      // All have customParams.mcp = {} (no type, no url, no command).
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: {} as any },
          identifier: 'plugin-vectorize-one',
        }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('no-endpoint');
    });

    it('refuses to migrate plugins with no mcp config at all', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({ customParams: {}, identifier: 'plugin-identifier' }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('no-mcp');
    });
  });

  describe('Shape #5 — http + auth=none + url + headers (173 prod rows)', () => {
    it('produces a header credential', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            mcp: {
              auth: { type: 'none' },
              headers: { 'X-Tenant': 'acme', 'X-Empty': '   ', '': 'ignored' },
              type: 'http',
              url: 'https://mcp.example.com',
            },
          },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      // whitespace-only value AND empty key both dropped
      expect(r.payload.credentials).toEqual({
        headers: { 'X-Tenant': 'acme' },
        type: 'header',
      });
    });
  });

  describe('Shape #6 — http + auth missing + url (113 prod rows)', () => {
    it('treats missing auth the same as auth=none', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
          identifier: 'context7',
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.credentials).toBeUndefined();
      expect(r.payload.mcpServerUrl).toBe('https://mcp.example.com');
    });
  });

  describe('Shape #7 — http + bearer + url + headers (38 prod rows, fold required)', () => {
    it('folds bearer + headers into a single Authorization header credential', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            mcp: {
              auth: { token: 'sk-xyz', type: 'bearer' },
              headers: { 'X-Tenant': 'acme', 'X-Trace': 'on' },
              type: 'http',
              url: 'https://mcp.example.com',
            },
          },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.credentials).toEqual({
        headers: {
          'Authorization': 'Bearer sk-xyz',
          'X-Tenant': 'acme',
          'X-Trace': 'on',
        },
        type: 'header',
      });
    });

    it('user-supplied Authorization header is overwritten by bearer fold (predictable)', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            mcp: {
              auth: { token: 'sk-xyz', type: 'bearer' },
              headers: { Authorization: 'Bearer userpicked' },
              type: 'http',
              url: 'https://mcp.example.com',
            },
          },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      // Spread order in the implementation puts the fold AFTER the user's
      // headers — verify the user's value (last write) wins. If we ever flip
      // this, callers that relied on "bearer takes precedence" need adjusting.
      expect(
        (r.payload.credentials as { headers: Record<string, string> }).headers.Authorization,
      ).toBe('Bearer userpicked');
    });
  });

  describe('Shape #8 — http + auth missing + url + headers (2 prod rows)', () => {
    it('treats as header credential, same as shape #5', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            mcp: {
              headers: { 'X-API-Key': 'k1' },
              type: 'http',
              url: 'https://mcp.example.com',
            },
          },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.credentials).toEqual({
        headers: { 'X-API-Key': 'k1' },
        type: 'header',
      });
    });
  });

  describe('Shape #9 — broken: type=mcp (1 prod row)', () => {
    it('refuses to migrate when transport is unknown AND there is no endpoint', () => {
      // Real identifier: curl_runner_update2
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { type: 'mcp' as any } },
          identifier: 'curl_runner_update2',
        }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('no-endpoint');
    });

    it('treats unknown transport WITH a url as http (best-effort recovery)', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { type: 'mcp' as any, url: 'https://mcp.example.com' } },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.mcpConnectionType).toBe('http');
      expect(r.payload.mcpServerUrl).toBe('https://mcp.example.com');
    });
  });

  describe('URL validation', () => {
    it('rejects malformed URLs', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({ customParams: { mcp: { type: 'http', url: 'not a url' } } }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('no-endpoint');
    });

    it('trims whitespace-padded URLs', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { type: 'http', url: '  https://mcp.example.com  ' } },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.mcpServerUrl).toBe('https://mcp.example.com');
    });
  });

  describe('Metadata + display name', () => {
    it('uses manifest.meta.title when available', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
          identifier: 'mymcp',
          manifest: { meta: { title: 'My Cool MCP' } } as any,
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.name).toBe('My Cool MCP');
    });

    it('falls back to identifier when no manifest title or description', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
          identifier: 'mymcp',
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.name).toBe('mymcp');
    });

    it('preserves description + avatar in metadata, flagged as migrated', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            avatar: '🚀',
            description: 'Does cool things',
            mcp: { type: 'http', url: 'https://mcp.example.com' },
          },
          identifier: 'mymcp',
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.metadata).toEqual({
        avatar: '🚀',
        description: 'Does cool things',
        migratedFromCustomPlugin: true,
      });
    });
  });

  describe('Edge cases observed via SQL probe', () => {
    it('handles `args` field absent on stdio plugin (defaults to empty)', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { command: 'my-bin', type: 'stdio' } },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.mcpStdioConfig?.args).toEqual([]);
    });

    it('stdio with empty command is rejected', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: { mcp: { command: '   ', type: 'stdio' } },
        }),
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('no-endpoint');
    });

    it('mcp.headers as array is ignored (defensive — historic dirty data)', () => {
      const r = buildConnectorPayloadFromLegacy(
        plugin({
          customParams: {
            mcp: { headers: ['weird'] as any, type: 'http', url: 'https://mcp.example.com' },
          },
        }),
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.payload.credentials).toBeUndefined();
    });
  });
});

describe('executeLegacyMigrationSave', () => {
  const legacy = (id = 'my-mcp'): LobeToolCustomPlugin =>
    ({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
      identifier: id,
      type: 'customPlugin',
    }) as LobeToolCustomPlugin;

  let createConnector: ReturnType<typeof vi.fn>;
  let deleteConnector: ReturnType<typeof vi.fn>;
  let hasExistingConnector: ReturnType<typeof vi.fn>;
  let syncConnectorTools: ReturnType<typeof vi.fn>;
  let uninstallCustomPlugin: ReturnType<typeof vi.fn>;
  let calls: string[];
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    calls = [];
    createConnector = vi.fn(async () => {
      calls.push('createConnector');
      return 'new-conn-id';
    });
    deleteConnector = vi.fn(async () => {
      calls.push('deleteConnector');
    });
    // Default: no pre-existing connector (the common fresh-migration case).
    hasExistingConnector = vi.fn(() => false);
    syncConnectorTools = vi.fn(async () => {
      calls.push('syncConnectorTools');
    });
    uninstallCustomPlugin = vi.fn(async () => {
      calls.push('uninstallCustomPlugin');
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('runs create → sync → uninstall in exact order on the happy path', async () => {
    const result = await executeLegacyMigrationSave(legacy(), legacy(), {
      createConnector,
      deleteConnector,
      hasExistingConnector,
      syncConnectorTools,
      uninstallCustomPlugin,
    });
    expect(result).toEqual({ connectorId: 'new-conn-id', ok: true });
    expect(calls).toEqual(['createConnector', 'syncConnectorTools', 'uninstallCustomPlugin']);
  });

  it('forwards the migrated payload to createConnector', async () => {
    const value = {
      customParams: {
        mcp: { auth: { token: 'sk-x', type: 'bearer' }, type: 'http', url: 'https://m.example' },
      },
      identifier: 'agent-x',
      type: 'customPlugin',
    } as LobeToolCustomPlugin;

    await executeLegacyMigrationSave(legacy('agent-x'), value, {
      createConnector,
      deleteConnector,
      hasExistingConnector,
      syncConnectorTools,
      uninstallCustomPlugin,
    });

    const payload = createConnector.mock.calls[0][0];
    expect(payload.identifier).toBe('agent-x');
    expect(payload.mcpServerUrl).toBe('https://m.example');
    expect(payload.credentials).toEqual({ token: 'sk-x', type: 'bearer' });
    expect(payload.sourceType).toBe('custom');
  });

  it('forces the LEGACY identifier on the created connector (form rename is ignored)', async () => {
    // DevModal's edit form lets the user retype the identifier. Allowing that
    // through would orphan every agent that already references the legacy
    // identifier: the new connector lands under a new key, the legacy row
    // gets deleted under the OLD key, and `agentConfig.plugins[i]` matches
    // neither. The orchestrator must pin the create payload to the legacy
    // identifier regardless of what the form ended up with.
    await executeLegacyMigrationSave(legacy('legacy-id'), legacy('renamed-in-form'), {
      createConnector,
      deleteConnector,
      hasExistingConnector,
      syncConnectorTools,
      uninstallCustomPlugin,
    });

    expect(createConnector).toHaveBeenCalledTimes(1);
    expect(createConnector.mock.calls[0][0].identifier).toBe('legacy-id');
    // And the legacy row to delete is the one keyed by the original identifier.
    expect(uninstallCustomPlugin).toHaveBeenCalledWith('legacy-id');
  });

  it('returns validation failure WITHOUT touching any side effects', async () => {
    const broken = {
      customParams: { mcp: {} as any },
      identifier: 'broken',
      type: 'customPlugin',
    } as LobeToolCustomPlugin;
    const result = await executeLegacyMigrationSave(broken, broken, {
      createConnector,
      deleteConnector,
      hasExistingConnector,
      syncConnectorTools,
      uninstallCustomPlugin,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-endpoint');
    expect(createConnector).not.toHaveBeenCalled();
    expect(syncConnectorTools).not.toHaveBeenCalled();
    expect(uninstallCustomPlugin).not.toHaveBeenCalled();
  });

  it('rethrows createConnector failure and leaves legacy plugin in place', async () => {
    createConnector.mockRejectedValueOnce(new Error('boom: bad network'));
    await expect(
      executeLegacyMigrationSave(legacy(), legacy(), {
        createConnector,
        deleteConnector,
        hasExistingConnector,
        syncConnectorTools,
        uninstallCustomPlugin,
      }),
    ).rejects.toThrow('boom: bad network');
    expect(syncConnectorTools).not.toHaveBeenCalled();
    expect(uninstallCustomPlugin).not.toHaveBeenCalled();
    // Nothing was created, so there is nothing to roll back.
    expect(deleteConnector).not.toHaveBeenCalled();
  });

  it('rolls back the created connector when tool sync fails, leaving legacy plugin in place', async () => {
    // Most likely failure in practice — MCP server unreachable at sync time.
    // The half-created connector must be deleted so it does not linger as a
    // tool-less duplicate; the legacy plugin row is left untouched so the user
    // can retry the save once the endpoint is healthy.
    syncConnectorTools.mockRejectedValueOnce(new Error('mcp tools/list timeout'));
    await expect(
      executeLegacyMigrationSave(legacy(), legacy(), {
        createConnector,
        deleteConnector,
        hasExistingConnector,
        syncConnectorTools,
        uninstallCustomPlugin,
      }),
    ).rejects.toThrow('mcp tools/list timeout');
    // `syncConnectorTools` is invoked but its mock rejects without recording a
    // call, so `calls` shows create → rollback delete.
    expect(syncConnectorTools).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['createConnector', 'deleteConnector']);
    expect(deleteConnector).toHaveBeenCalledWith('new-conn-id');
    expect(uninstallCustomPlugin).not.toHaveBeenCalled();
  });

  it('does NOT roll back on sync failure when a connector already existed (idempotent update)', async () => {
    // `createConnector` is an upsert: a pre-existing row for this identifier is
    // UPDATED, not created. A transient sync failure must not delete it —
    // that would destroy a working connector's synced tools/credentials (e.g. a
    // prior successful migration whose best-effort legacy uninstall had failed).
    hasExistingConnector.mockReturnValue(true);
    syncConnectorTools.mockRejectedValueOnce(new Error('mcp tools/list timeout'));
    await expect(
      executeLegacyMigrationSave(legacy(), legacy(), {
        createConnector,
        deleteConnector,
        hasExistingConnector,
        syncConnectorTools,
        uninstallCustomPlugin,
      }),
    ).rejects.toThrow('mcp tools/list timeout');
    expect(deleteConnector).not.toHaveBeenCalled();
    expect(uninstallCustomPlugin).not.toHaveBeenCalled();
  });

  it('still rethrows the sync error even if the rollback delete also fails', async () => {
    syncConnectorTools.mockRejectedValueOnce(new Error('mcp tools/list timeout'));
    deleteConnector.mockRejectedValueOnce(new Error('rollback network error'));
    await expect(
      executeLegacyMigrationSave(legacy(), legacy(), {
        createConnector,
        deleteConnector,
        hasExistingConnector,
        syncConnectorTools,
        uninstallCustomPlugin,
      }),
    ).rejects.toThrow('mcp tools/list timeout');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[connector-migration] rollback after failed sync failed',
      expect.any(Error),
    );
    expect(uninstallCustomPlugin).not.toHaveBeenCalled();
  });

  it('swallows uninstallCustomPlugin failure (connector is the source of truth)', async () => {
    uninstallCustomPlugin.mockRejectedValueOnce(new Error('legacy delete failed'));
    const result = await executeLegacyMigrationSave(legacy(), legacy(), {
      createConnector,
      deleteConnector,
      hasExistingConnector,
      syncConnectorTools,
      uninstallCustomPlugin,
    });
    // Migration is still considered SUCCESSFUL — the runtime dedupes by
    // identifier and the connector wins, so the leaked legacy row is harmless.
    // Sync succeeded, so the connector is NOT rolled back.
    expect(result).toEqual({ connectorId: 'new-conn-id', ok: true });
    expect(deleteConnector).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[connector-migration] uninstall legacy plugin failed',
      expect.any(Error),
    );
  });

  it('idempotent retry: re-running after a rolled-back sync repeats all steps cleanly', async () => {
    // First attempt: sync fails → the created connector is rolled back.
    syncConnectorTools.mockRejectedValueOnce(new Error('first attempt fails'));
    await expect(
      executeLegacyMigrationSave(legacy(), legacy(), {
        createConnector,
        deleteConnector,
        hasExistingConnector,
        syncConnectorTools,
        uninstallCustomPlugin,
      }),
    ).rejects.toThrow('first attempt fails');
    expect(calls).toEqual(['createConnector', 'deleteConnector']);

    // Reset call log; retry. Server-side `connector.create` is idempotent on
    // (user_id, identifier), so the second create is an UPDATE.
    calls.length = 0;
    const result = await executeLegacyMigrationSave(legacy(), legacy(), {
      createConnector,
      deleteConnector,
      hasExistingConnector,
      syncConnectorTools,
      uninstallCustomPlugin,
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['createConnector', 'syncConnectorTools', 'uninstallCustomPlugin']);
  });
});
