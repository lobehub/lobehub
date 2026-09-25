// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  // The real `wsCompatProcedure` validates a Better-Auth session; these tests
  // exercise input validation, so auth is skipped and ctx carries the userId.
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});

const mockCreate = vi.fn();
const mockFindById = vi.fn();
const mockList = vi.fn();
const mockRotateSecret = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/database/models/oidcClient', () => ({
  OidcClientModel: vi.fn(function () {
    return {
      create: mockCreate,
      findById: mockFindById,
      list: mockList,
      rotateSecret: mockRotateSecret,
      update: mockUpdate,
    };
  }),
}));

const { oauthAppRouter } = await import('../oauthApp');

const webApp = {
  applicationType: 'web',
  clientSecret: 'iv:tag:cipher',
  id: 'lca_app',
  name: 'Develop Center',
  redirectUris: ['https://dc.lobehub.com/callback'],
};

describe('oauthAppRouter', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1' };
  const caller = () => oauthAppRouter.createCaller(ctx);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ client: webApp, secret: 'lcs_plain' });
  });

  describe('create', () => {
    it('defaults to a device app when no type is given', async () => {
      mockCreate.mockResolvedValue({
        client: { ...webApp, clientSecret: null },
        secret: undefined,
      });

      await caller().create({ name: 'My CLI' });

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ type: 'device' }));
    });

    it('returns the plaintext secret exactly once, alongside hasSecret', async () => {
      const created = await caller().create({
        name: 'Develop Center',
        redirectUris: ['https://dc.lobehub.com/callback'],
        type: 'web',
      });

      expect(created.clientSecret).toBe('lcs_plain');
      expect(created.hasSecret).toBe(true);
      expect(created).not.toHaveProperty('clientSecret', 'iv:tag:cipher');
    });

    it('lets a web app be created before its redirect URIs are configured', async () => {
      await caller().create({ name: 'Develop Center', type: 'web' });

      const [input] = mockCreate.mock.calls[0];
      expect(input.type).toBe('web');
      expect(input.redirectUris).toBeUndefined();
    });

    it.each([
      ['plain http on a public host', 'http://dc.lobehub.com/callback'],
      ['a wildcard host', 'https://*.lobehub.com/callback'],
      ['a fragment', 'https://dc.lobehub.com/callback#token'],
      ['a relative path', '/callback'],
    ])('rejects %s', async (_label, redirectUri) => {
      await expect(
        caller().create({ name: 'Develop Center', redirectUris: [redirectUri], type: 'web' }),
      ).rejects.toThrow();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('trims and de-duplicates redirect URIs before they reach the model', async () => {
      await caller().create({
        name: 'Develop Center',
        redirectUris: [
          ' https://dc.lobehub.com/callback ',
          'https://dc.lobehub.com/callback',
          'http://localhost:3022/callback',
        ],
        type: 'web',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUris: ['https://dc.lobehub.com/callback', 'http://localhost:3022/callback'],
        }),
      );
    });
  });

  describe('logo', () => {
    it('rejects an inline data-URI logo that oidc-provider would refuse', async () => {
      await expect(
        caller().create({ logoUri: 'data:image/png;base64,iVBORw0KGgo=', name: 'Logo App' }),
      ).rejects.toThrow();
      await expect(
        caller().update({
          id: 'lca_app',
          value: { logoUri: 'data:image/png;base64,iVBORw0KGgo=' },
        }),
      ).rejects.toThrow();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('accepts an uploaded https logo', async () => {
      await caller().create({ logoUri: 'https://files.lobehub.com/logo.png', name: 'Logo App' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ logoUri: 'https://files.lobehub.com/logo.png' }),
      );
    });

    it('lets an update clear the logo with null', async () => {
      await caller().update({ id: 'lca_app', value: { logoUri: null } });

      expect(mockUpdate).toHaveBeenCalledWith('lca_app', { logoUri: null });
    });
  });

  describe('read paths', () => {
    it('never leaks the stored secret', async () => {
      mockList.mockResolvedValue([webApp]);
      mockFindById.mockResolvedValue(webApp);

      const [listed] = await caller().list();
      const detail = await caller().getById({ id: 'lca_app' });

      expect(listed).not.toHaveProperty('clientSecret');
      expect(listed.hasSecret).toBe(true);
      expect(detail).not.toHaveProperty('clientSecret');
      expect(detail?.hasSecret).toBe(true);
    });
  });

  describe('update', () => {
    it('applies the same redirect URI rules', async () => {
      await expect(
        caller().update({ id: 'lca_app', value: { redirectUris: ['http://evil.example.com/cb'] } }),
      ).rejects.toThrow();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('refuses to strip a web app of every callback', async () => {
      await expect(
        caller().update({ id: 'lca_app', value: { redirectUris: [] } }),
      ).rejects.toThrow();
      await expect(
        caller().update({ id: 'lca_app', value: { redirectUris: ['   '] } }),
      ).rejects.toThrow();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('rotateSecret', () => {
    it('returns the new plaintext secret', async () => {
      mockRotateSecret.mockResolvedValue('lcs_rotated');

      await expect(caller().rotateSecret({ id: 'lca_app' })).resolves.toEqual({
        clientSecret: 'lcs_rotated',
      });
    });

    it('404s when the app has no secret to rotate', async () => {
      mockRotateSecret.mockResolvedValue(undefined);

      await expect(caller().rotateSecret({ id: 'lca_app' })).rejects.toThrow();
    });
  });
});
