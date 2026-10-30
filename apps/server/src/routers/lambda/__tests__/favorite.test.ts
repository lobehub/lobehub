// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); stub it (the model mock
// ignores the db handle anyway).
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const mockAdd = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockReorder = vi.fn();
const modelScopes: unknown[][] = [];

vi.mock('@/database/models/favorite', () => ({
  FavoriteLimitError: class FavoriteLimitError extends Error {},
  FavoriteModel: vi.fn(function (...args: unknown[]) {
    modelScopes.push(args.slice(1));
    return { add: mockAdd, remove: mockRemove, reorder: mockReorder, update: mockUpdate };
  }),
}));

const { favoriteRouter } = await import('../favorite');

describe('favoriteRouter', () => {
  const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' };
  const favoriteId = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const input = { path: '/page/docs_a', targetId: 'docs_a', title: 'Spec', type: 'page' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    modelScopes.length = 0;
  });

  it('scopes favorites to the caller and the active workspace', async () => {
    mockAdd.mockResolvedValue({ ...input, icon: null, id: favoriteId });

    await favoriteRouter.createCaller(ctx).add(input);

    expect(modelScopes).toEqual([['user-1', 'ws-1']]);
    expect(mockAdd).toHaveBeenCalledWith(input);
  });

  it.each(['https://evil.example', '//evil.example/page', '/\\evil.example', 'page/docs_a'])(
    'refuses a link that leaves the app: %s',
    async (path) => {
      await expect(favoriteRouter.createCaller(ctx).add({ ...input, path })).rejects.toThrow();
      await expect(
        favoriteRouter.createCaller(ctx).update({ id: favoriteId, value: { path } }),
      ).rejects.toThrow();

      expect(mockAdd).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it('reports a full sidebar as a bad request', async () => {
    const { FavoriteLimitError } = await import('@/database/models/favorite');
    mockAdd.mockRejectedValue(new FavoriteLimitError());

    await expect(favoriteRouter.createCaller(ctx).add(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('refuses an id that is not a favorite uuid', async () => {
    const caller = favoriteRouter.createCaller(ctx);

    await expect(caller.remove({ id: 'optimistic:page:docs_a' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.update({ id: 'fav_1', value: { title: 'Spec' } })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.reorder({ ids: [favoriteId, 'not-a-uuid'] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockReorder).not.toHaveBeenCalled();
  });

  it('cuts a long page title instead of refusing the favorite', async () => {
    mockAdd.mockImplementation(async (value) => ({ ...value, icon: null, id: favoriteId }));

    await favoriteRouter.createCaller(ctx).add({ ...input, title: 'a'.repeat(600) });

    expect(mockAdd).toHaveBeenCalledWith({ ...input, title: 'a'.repeat(512) });
  });

  it('refuses a blank title', async () => {
    await expect(
      favoriteRouter.createCaller(ctx).add({ ...input, title: '   ' }),
    ).rejects.toThrow();
  });
});
