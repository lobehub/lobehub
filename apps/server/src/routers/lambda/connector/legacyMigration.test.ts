import type { LobeTool } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildConnectorMigrationRow } from './legacyMigration';

const plugin = (overrides: Partial<LobeTool> = {}): LobeTool =>
  ({
    customParams: { mcp: { type: 'http', url: 'https://mcp.example.com' } },
    identifier: 'github-mcp',
    manifest: {
      description: 'GitHub tools',
      icon: 'avatar',
      identifier: 'github-mcp',
      name: 'GitHub',
      version: '1.2.3',
    },
    type: 'plugin',
    ...overrides,
  }) as LobeTool;

describe('buildConnectorMigrationRow', () => {
  it('preserves a marketplace bearer connection and bakes settings into URL and headers', () => {
    const result = buildConnectorMigrationRow(
      plugin({
        manifest: {
          api: [{ humanIntervention: 'always', name: 'send' }, { name: 'search' }],
          description: 'GitHub tools',
          icon: 'avatar',
          identifier: 'github-mcp',
          name: 'GitHub',
          version: '1.2.3',
        },
        customParams: {
          mcp: {
            auth: { token: ' secret-token ', type: 'bearer' },
            headers: { 'X-Team': 'core' },
            type: 'http',
            url: 'https://mcp.example.com/{{team}}?apikey={{config.API_KEY}}',
          },
        },
        settings: { API_KEY: 'key 1', REGION: 'us', team: 'platform' },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      credentials: JSON.stringify({ token: 'secret-token', type: 'bearer' }),
      identifier: 'github-mcp',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://mcp.example.com/platform?apikey=key%201',
      name: 'GitHub',
      sourceType: 'marketplace',
    });
    expect(result.payload.metadata).toMatchObject({
      avatar: 'avatar',
      customHeaders: { 'REGION': 'us', 'X-Team': 'core' },
      description: 'GitHub tools',
      marketplaceInstalled: true,
      marketplaceToolPolicies: { search: null, send: 'always' },
      migratedFromLegacyPlugin: true,
      version: '1.2.3',
    });
  });

  it('preserves approval policies from the market MCP tools shape', () => {
    const result = buildConnectorMigrationRow(
      plugin({
        manifest: {
          description: 'GitHub tools',
          icon: 'avatar',
          name: 'GitHub',
          tools: [
            { inputSchema: {}, humanIntervention: 'always', name: 'send' },
            { inputSchema: {}, name: 'search' },
          ],
          version: '1.2.3',
        } as never,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.metadata?.marketplaceToolPolicies).toEqual({
      search: null,
      send: 'always',
    });
  });

  it('copies OAuth credentials without exposing them to the client and keeps a reauthorization client', () => {
    const result = buildConnectorMigrationRow(
      plugin({
        customParams: {
          mcp: {
            auth: {
              accessToken: 'access-token',
              clientId: 'client-id',
              clientSecret: 'client-secret',
              type: 'oauth2',
            },
            type: 'http',
            url: 'https://mcp.example.com',
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.credentials).toBe(
      JSON.stringify({ accessToken: 'access-token', type: 'oauth2' }),
    );
    expect(result.payload.oidcConfig).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scheme: 'pre_registration',
    });
  });

  it('preserves stdio command config and merges settings into args and env', () => {
    const result = buildConnectorMigrationRow(
      plugin({
        customParams: {
          mcp: {
            args: ['-y', 'server', '--token={{config.API_KEY}}'],
            command: 'npx',
            env: { MODE: 'prod' },
            type: 'stdio',
          },
        },
        settings: { API_KEY: 'secret' },
        type: 'customPlugin',
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.mcpConnectionType).toBe('stdio');
    expect(result.payload.mcpStdioConfig).toEqual({
      args: ['-y', 'server', '--token=secret'],
      command: 'npx',
      env: { API_KEY: 'secret', MODE: 'prod' },
    });
    expect(result.payload.sourceType).toBe('custom');
    expect(result.payload.metadata?.marketplaceInstalled).toBeUndefined();
  });

  it('preserves a market-hosted cloud endpoint and its settings headers', () => {
    const result = buildConnectorMigrationRow(
      plugin({
        customParams: {
          mcp: {
            cloudEndPoint: 'https://cloud.example.com/mcp',
            headers: { 'X-Base': '1' },
            type: 'cloud',
          },
        },
        settings: { API_KEY: 'secret' },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.mcpConnectionType).toBe('cloud');
    expect(result.payload.metadata).toMatchObject({
      cloudEndPoint: 'https://cloud.example.com/mcp',
      customHeaders: { 'API_KEY': 'secret', 'X-Base': '1' },
    });
  });

  it('lets explicit repair connection values override preserved settings', () => {
    const result = buildConnectorMigrationRow(
      plugin({
        customParams: {
          mcp: {
            env: { API_KEY: 'repaired-key' },
            type: 'stdio',
            command: 'npx',
          },
        },
        settings: { API_KEY: 'old-key' },
      }),
      { preferConnectionValues: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.mcpStdioConfig?.env).toEqual({ API_KEY: 'repaired-key' });
  });

  it('validates a URL template only after rendering settings into it', () => {
    const result = buildConnectorMigrationRow(
      plugin({
        customParams: {
          mcp: { type: 'http', url: 'https://example.com:{{config.PORT}}/mcp' },
        },
        settings: { PORT: '8443' },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.mcpServerUrl).toBe('https://example.com:8443/mcp');
  });

  it('keeps the OAuth client for an authorization repair before an access token exists', () => {
    const result = buildConnectorMigrationRow(
      plugin({
        customParams: {
          mcp: {
            auth: { clientId: 'client-id', clientSecret: 'client-secret', type: 'oauth2' },
            type: 'http',
            url: 'https://mcp.example.com',
          },
        },
      }),
      { preferConnectionValues: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.credentials).toBeUndefined();
    expect(result.payload.oidcConfig).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scheme: 'pre_registration',
    });
  });

  it('refuses rows with no usable endpoint instead of dropping their connection silently', () => {
    expect(buildConnectorMigrationRow(plugin({ customParams: {} }))).toEqual({
      ok: false,
      reason: 'no-mcp',
    });
    expect(
      buildConnectorMigrationRow(
        plugin({ customParams: { mcp: { type: 'http', url: 'not-a-url' } } }),
      ),
    ).toEqual({ ok: false, reason: 'no-endpoint' });
  });
});
