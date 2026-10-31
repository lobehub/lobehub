import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposioPersonalConnectorBackend, MarketPersonalConnectorBackend } from './backends';

vi.mock('@/config/composio', () => ({ getServerComposioAuthConfigId: () => 'auth-config' }));

const row = () => ({
  id: 'local-connection',
  userId: 'owner',
  providerId: 'gmail',
  name: 'Gmail',
  revision: 1,
  status: 'authorizing' as const,
  managed: true,
  isEnabled: false,
  agentIds: [],
  readToolNames: [],
  remoteId: 'remote-account',
});

describe('Composio personal connector adapter', () => {
  const account = () => ({
    id: 'remote-account',
    status: 'ACTIVE',
    toolkit: { slug: 'gmail' },
    data: { email: 'lin@example.com', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] },
  });
  const client = {
    authConfigs: { list: vi.fn(), create: vi.fn() },
    connectedAccounts: { get: vi.fn(), list: vi.fn(), link: vi.fn(), delete: vi.fn() },
    tools: { getRawComposioTools: vi.fn(), getRawComposioToolBySlug: vi.fn() },
  };
  const syncTools = vi.fn();
  const adapter = () =>
    new ComposioPersonalConnectorBackend({
      providerId: 'gmail',
      userId: 'owner',
      client,
      available: true,
      syncTools,
      revokeAccount: async (_connection, remove) => remove(),
    });

  beforeEach(() => {
    vi.resetAllMocks();
    client.connectedAccounts.get.mockResolvedValue(account());
    client.connectedAccounts.list.mockResolvedValue({ items: [account()] });
    client.connectedAccounts.link.mockResolvedValue({
      id: 'remote-account',
      redirectUrl: 'https://provider.example/consent',
    });
    client.tools.getRawComposioTools.mockResolvedValue({
      items: [
        {
          slug: 'GMAIL_FETCH_EMAILS',
          version: '20261029_00',
          inputParameters: { type: 'object', properties: {} },
        },
        {
          slug: 'GMAIL_SEND_EMAIL',
          version: '20261029_00',
          inputParameters: { type: 'object', properties: {} },
        },
        { slug: 'GMAIL_SEARCH_AND_ARCHIVE', version: '20261029_00', crudType: 'read' },
      ],
    });
  });

  it('does not revoke an account outside the authenticated owner inventory', async () => {
    client.connectedAccounts.list.mockResolvedValue({ items: [] });
    await expect(adapter().revoke(row())).rejects.toThrow(/owner/i);
    expect(client.connectedAccounts.delete).not.toHaveBeenCalled();
  });
  it('finishes a retry when the account disappeared before inventory and authoritative lookup confirms deletion', async () => {
    client.connectedAccounts.list.mockResolvedValue({ items: [] });
    client.connectedAccounts.get.mockRejectedValue({ status: 404 });
    await expect(adapter().revoke(row())).resolves.toBeUndefined();
    expect(client.connectedAccounts.delete).not.toHaveBeenCalled();
  });
  it('keeps an unknown absent account stopped without claiming remote deletion', async () => {
    client.connectedAccounts.list.mockResolvedValue({ items: [] });
    client.connectedAccounts.get.mockRejectedValue({ status: 503 });
    await expect(adapter().revoke(row())).rejects.toBeDefined();
    expect(client.connectedAccounts.delete).not.toHaveBeenCalled();
  });
  it('treats an already-removed provider account as an idempotent disconnect', async () => {
    client.connectedAccounts.delete.mockRejectedValueOnce({ status: 404 });
    await expect(adapter().revoke(row())).resolves.toBeUndefined();
  });

  it('creates an account link for the authenticated owner and controlled callback', async () => {
    const result = await adapter().authorize(
      row(),
      'https://app.example/api/connectors/oauth/callback?session=one',
    );
    expect(result).toMatchObject({
      remoteId: 'remote-account',
      url: 'https://provider.example/consent',
    });
    expect(client.connectedAccounts.link).toHaveBeenCalledWith('owner', 'auth-config', {
      callbackUrl: 'https://app.example/api/connectors/oauth/callback?session=one',
    });
  });

  it('does not invent a restorable principal identity when the provider omits the account identity', async () => {
    const unidentified = {
      ...account(),
      data: { scopes: ['https://www.googleapis.com/auth/gmail.readonly'] },
    };
    client.connectedAccounts.get.mockResolvedValue(unidentified);
    client.connectedAccounts.list.mockResolvedValue({ items: [unidentified] });
    expect((await adapter().inspect(row())).accountKey).toBeUndefined();
  });
  it('reports broad provider scopes separately from its restricted executable tools', async () => {
    const broad = {
      ...account(),
      data: { email: 'lin@example.com', scopes: ['https://mail.google.com/'] },
    };
    client.connectedAccounts.get.mockResolvedValue(broad);
    expect(await adapter().inspect(row())).toMatchObject({
      status: 'ready',
      grantedScopes: ['https://mail.google.com/'],
      readToolNames: ['GMAIL_FETCH_EMAILS'],
    });
  });
  it('admits only verified read operations and pins their concrete provider version', async () => {
    const result = await adapter().inspect(row());
    expect(result).toMatchObject({
      status: 'ready',
      accountLabel: 'lin@example.com',
      readToolNames: ['GMAIL_FETCH_EMAILS'],
      readToolVersions: { GMAIL_FETCH_EMAILS: '20261029_00' },
    });
  });

  it('does not confuse an identity-only OAuth grant with Gmail read permission', async () => {
    const identityOnly = {
      ...account(),
      data: { email: 'lin@example.com', scopes: ['openid', 'email'] },
    };
    client.connectedAccounts.get.mockResolvedValue(identityOnly);
    client.connectedAccounts.list.mockResolvedValue({ items: [identityOnly] });
    expect((await adapter().inspect(row())).status).toBe('permission_required');
  });

  it('cannot inspect a remote account outside the authenticated owner inventory', async () => {
    client.connectedAccounts.list.mockResolvedValue({ items: [] });
    expect((await adapter().inspect(row())).status).not.toBe('ready');
  });

  it('does not enable an unversioned tool merely because its name was previously approved', async () => {
    client.tools.getRawComposioTools.mockResolvedValue({ items: [{ slug: 'GMAIL_FETCH_EMAILS' }] });
    client.tools.getRawComposioToolBySlug.mockResolvedValue({ version: 'latest' });
    expect((await adapter().inspect(row())).status).toBe('sync_failed');
  });
});

describe('Market personal connector adapter', () => {
  const market = {
    market: {
      connect: { authorize: vi.fn(), getStatus: vi.fn(), getHealth: vi.fn(), revoke: vi.fn() },
    },
    listSkillTools: vi.fn(),
  };
  const adapter = () =>
    new MarketPersonalConnectorBackend({
      userId: 'owner',
      market: market as any,
      available: true,
      syncTools: vi.fn(),
    });

  beforeEach(() => {
    vi.resetAllMocks();
    market.market.connect.getStatus.mockResolvedValue({
      success: true,
      connected: true,
      connection: {
        providerId: 'notion',
        providerUserId: 'workspace-1',
        providerName: 'Notion workspace',
        scopes: [],
        createdAt: '2026-10-30T00:00:00Z',
        updatedAt: '2026-10-30T00:00:00Z',
      },
    });
    market.market.connect.getHealth.mockResolvedValue({ success: true, healthy: true });
  });

  it('does not offer native Notion authorization without an account-bound Market operation contract', () => {
    expect(adapter().provider).toMatchObject({
      available: false,
      unavailableReason: 'account_binding_required',
    });
  });
  it('keeps unknown provider status as a failed revoke, and never deletes a possibly replaced managed account', async () => {
    market.market.connect.getStatus.mockResolvedValueOnce({ success: false, connected: false });
    await expect(adapter().revoke({ ...row(), providerId: 'notion' })).rejects.toThrow();
    market.market.connect.getStatus.mockResolvedValueOnce({
      success: true,
      connected: true,
      connection: { providerUserId: 'workspace-1', createdAt: '2026-10-30T00:00:00Z' },
    });
    await expect(adapter().revoke({ ...row(), providerId: 'notion' })).rejects.toThrow(/bound/i);
  });

  it('does not treat fallback tool definitions as proof that a Notion connection is usable', async () => {
    market.listSkillTools.mockResolvedValue({
      source: 'static',
      tools: [{ name: 'notion-search' }],
    });
    expect((await adapter().inspect({ ...row(), providerId: 'notion' })).status).toBe(
      'sync_failed',
    );
  });

  it('excludes Notion writes even if live discovery exposes them alongside reads', async () => {
    market.listSkillTools.mockResolvedValue({
      source: 'live',
      tools: [
        { name: 'notion-search', inputSchema: { type: 'object' } },
        { name: 'notion-create-pages', inputSchema: { type: 'object' } },
      ],
    });
    expect(await adapter().inspect({ ...row(), providerId: 'notion' })).toMatchObject({
      status: 'ready',
      readToolNames: ['notion-search'],
    });
  });
});
