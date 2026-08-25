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

/**
 * `workspace_viewer` is read-only: it holds no `agent:update` grant, so every
 * brief mutation must sit behind that gate. `resolve` / `resolveManyAsRead` /
 * `delete` clear the `hasUnresolvedUrgentByTask` predicate that parks a task
 * between automated runs, so dismissing a brief resumes the agent and spends
 * workspace budget — not something a read-only role may trigger.
 */
describe('briefRouter — every mutation is gated on the writable-role permission', () => {
  const mutations: [string, () => Promise<unknown>][] = [
    ['create', () => createCaller().create({ summary: 's', title: 't', type: 'insight' })],
    ['delete', () => createCaller().delete({ id: 'brief-1' })],
    ['markRead', () => createCaller().markRead({ id: 'brief-1' })],
    ['resolve', () => createCaller().resolve({ action: 'approve', id: 'brief-1' })],
    ['resolveManyAsRead', () => createCaller().resolveManyAsRead({ ids: ['brief-1'] })],
  ];

  it.each(mutations)('%s requires the task-domain agent:update action', async (_name, call) => {
    // `task:update` is not an RBAC action and is rejected for every role
    // including Owner — asserting the exact code keeps that regression out.
    await expect(call()).rejects.toThrow('GATE:agent:update');
  });
});

describe('briefRouter — reads stay open to every workspace role', () => {
  it('does not gate listUnresolved', async () => {
    // Reaches the handler (and fails on the stub db) instead of throwing GATE:*.
    await expect(createCaller().listUnresolved()).rejects.not.toThrow(/^GATE:/);
  });

  it('does not gate list', async () => {
    await expect(createCaller().list({ limit: 50, offset: 0 })).rejects.not.toThrow(/^GATE:/);
  });

  it('does not gate listNewsByDay', async () => {
    await expect(
      createCaller().listNewsByDay({
        endAt: new Date('2026-08-06T00:00:00Z'),
        startAt: new Date('2026-08-05T00:00:00Z'),
      }),
    ).rejects.not.toThrow(/^GATE:/);
  });
});
