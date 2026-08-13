// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

import {
  assertFileNotInRestrictedKnowledgeBase,
  filterRestrictedKnowledgeBases,
  getRestrictedKnowledgeBaseIds,
} from './knowledgeBaseAccess';

vi.mock('@/server/services/workspacePermission', () => ({
  getWorkspaceScopedPermissionMatches: vi.fn(),
}));

const permissionMatchesMock = vi.mocked(getWorkspaceScopedPermissionMatches);

/**
 * Fake drizzle db returning one prepared result per `select()` call, in order.
 * Supports both the plain `.from().where()` and `.from().innerJoin().where()`
 * chains the helpers issue.
 */
const dbWithResults = (...results: unknown[][]) => {
  let call = 0;
  const next = () => Promise.resolve(results[call++] ?? []);
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: next }),
        where: next,
      }),
    }),
  } as unknown as LobeChatDatabase;
};

beforeEach(() => {
  vi.clearAllMocks();
  permissionMatchesMock.mockResolvedValue({ hasAllScope: false, hasOwnerScope: true });
});

describe('getRestrictedKnowledgeBaseIds', () => {
  it('returns nothing in personal mode without touching the database', async () => {
    const ctx = { serverDB: dbWithResults([{ id: 'kb-1' }]), userId: 'u1' };

    await expect(getRestrictedKnowledgeBaseIds(ctx)).resolves.toEqual([]);
    expect(permissionMatchesMock).not.toHaveBeenCalled();
  });

  it('returns restricted KB ids for a non-privileged member', async () => {
    const ctx = {
      serverDB: dbWithResults([{ id: 'kb-1' }, { id: 'kb-2' }]),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(getRestrictedKnowledgeBaseIds(ctx)).resolves.toEqual(['kb-1', 'kb-2']);
  });

  it('returns nothing for a KNOWLEDGE_BASE_UPDATE:all curator', async () => {
    permissionMatchesMock.mockResolvedValue({ hasAllScope: true, hasOwnerScope: false });
    const ctx = {
      serverDB: dbWithResults([{ id: 'kb-1' }]),
      userId: 'admin',
      workspaceId: 'ws-1',
    };

    await expect(getRestrictedKnowledgeBaseIds(ctx)).resolves.toEqual([]);
  });

  it('skips the RBAC lookup when no restriction rows exist', async () => {
    const ctx = { serverDB: dbWithResults([]), userId: 'member', workspaceId: 'ws-1' };

    await expect(getRestrictedKnowledgeBaseIds(ctx)).resolves.toEqual([]);
    expect(permissionMatchesMock).not.toHaveBeenCalled();
  });
});

describe('filterRestrictedKnowledgeBases', () => {
  it('strips restricted KBs from the list for a member', async () => {
    const ctx = {
      serverDB: dbWithResults([{ id: 'kb-2' }]),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(
      filterRestrictedKnowledgeBases(ctx, [{ id: 'kb-1' }, { id: 'kb-2' }]),
    ).resolves.toEqual([{ id: 'kb-1' }]);
  });

  it('passes the list through untouched in personal mode', async () => {
    const ctx = { serverDB: dbWithResults([{ id: 'kb-1' }]), userId: 'u1' };

    await expect(filterRestrictedKnowledgeBases(ctx, [{ id: 'kb-1' }])).resolves.toEqual([
      { id: 'kb-1' },
    ]);
  });
});

describe('assertFileNotInRestrictedKnowledgeBase', () => {
  it('passes for a file with no knowledge base membership', async () => {
    const ctx = { serverDB: dbWithResults([]), userId: 'member', workspaceId: 'ws-1' };

    await expect(assertFileNotInRestrictedKnowledgeBase(ctx, 'file-1')).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when the file belongs to a restricted KB', async () => {
    const ctx = {
      // 1st select: memberships; 2nd select: restriction rows
      serverDB: dbWithResults([{ knowledgeBaseId: 'kb-1' }], [{ id: 'kb-1' }]),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(assertFileNotInRestrictedKnowledgeBase(ctx, 'file-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('passes when the file only belongs to open KBs', async () => {
    const ctx = {
      serverDB: dbWithResults([{ knowledgeBaseId: 'kb-open' }], [{ id: 'kb-restricted' }]),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(assertFileNotInRestrictedKnowledgeBase(ctx, 'file-1')).resolves.toBeUndefined();
  });
});
