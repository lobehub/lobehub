// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

// Surface the permission requested by the procedure so this test catches
// invalid or task-router-inconsistent RBAC actions before they reach cloud.
vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn((code: string) => () => {
    throw new Error(`GATE:${code}`);
  }),
}));

const { briefRouter } = await import('../brief');

const createCaller = () =>
  briefRouter.createCaller({ serverDB: {}, userId: 'user-1', workspaceId: 'ws-1' } as any);

describe('briefRouter — write permission gate', () => {
  it('resolveManyAsRead uses the task-domain agent:update permission', async () => {
    await expect(createCaller().resolveManyAsRead({ ids: ['brief-1'] })).rejects.toThrow(
      'GATE:agent:update',
    );
  });
});
