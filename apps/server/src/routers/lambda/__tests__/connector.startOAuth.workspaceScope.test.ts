// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import { saveConnectorOAuthState } from '@/server/services/connector/stateStore';

import { connectorRouter } from '../connector';

// Same hoisting note as connector.syncPluginTools.test.ts: `vi.mock` is lifted
// above the imports at runtime, so the mocks are active when the router module
// evaluates. They sit below the imports to satisfy `import-x/first`.
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));
vi.mock('@/server/services/connector/oauth', () => ({
  buildAuthorizationUrl: vi
    .fn()
    .mockResolvedValue({ authorizationUrl: 'https://as/authorize', codeVerifier: 'verifier' }),
  discoverConnectorOAuth: vi.fn().mockResolvedValue({
    authorizationServerUrl: 'https://as',
    metadata: {
      authorization_endpoint: 'https://as/authorize',
      registration_endpoint: 'https://as/register',
      scopes_supported: ['read'],
      token_endpoint: 'https://as/token',
    },
  }),
  getConnectorRedirectUri: () => 'https://app.example.com/oauth/connector/callback',
  registerDynamicClient: vi.fn(),
}));
vi.mock('@/server/services/connector/stateStore', () => ({
  generateConnectorOAuthState: () => 'state-token',
  saveConnectorOAuthState: vi.fn(),
}));

/**
 * The OAuth callback is a browser redirect from the authorization server — it
 * carries no `X-Workspace-Id` header, so the scope can only reach it through
 * the Redis-backed state payload. If `startOAuth` omits it, the callback builds
 * its models scope-less, `buildWorkspaceWhere` reads that as "personal only"
 * (`workspace_id IS NULL`), and `findById` misses every workspace connector —
 * authorization dies on `connector_not_found`. See the callback-side half in
 * src/app/(backend)/oauth/connector/callback/route.test.ts.
 */
describe('connectorRouter.startOAuth — workspace scope survives the redirect', () => {
  let connectorModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    connectorModelMock = {
      findById: vi.fn().mockResolvedValue({
        id: 'conn-1',
        mcpServerUrl: 'https://mcp.example.com',
        oidcConfig: { clientId: 'cid', scheme: 'pre_registration' },
        userId: 'user_test',
      }),
      update: vi.fn(),
    };

    vi.mocked(ConnectorModel).mockImplementation(() => connectorModelMock);
    vi.mocked(ConnectorToolModel).mockImplementation(() => ({}) as any);
    vi.mocked(PluginModel).mockImplementation(() => ({}) as any);
  });

  const callerFor = (workspaceId?: string) =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: workspaceId ?? null,
    } as any);

  const connectorId = '00000000-0000-4000-8000-000000000001';

  it('stashes the active workspace id in the OAuth state', async () => {
    await callerFor('ws-1').startOAuth({ id: connectorId });

    expect(saveConnectorOAuthState).toHaveBeenCalledWith(
      'state-token',
      expect.objectContaining({ lobeUserId: 'user_test', workspaceId: 'ws-1' }),
    );
  });

  it('leaves the workspace id undefined for a personal-scope flow', async () => {
    await callerFor().startOAuth({ id: connectorId });

    expect(saveConnectorOAuthState).toHaveBeenCalledWith(
      'state-token',
      expect.objectContaining({ lobeUserId: 'user_test', workspaceId: undefined }),
    );
  });
});
