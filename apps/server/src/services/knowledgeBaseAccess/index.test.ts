// @vitest-environment node
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

import {
  assertContentsNotInRestrictedKnowledgeBase,
  assertFileNotInRestrictedKnowledgeBase,
  filterRestrictedKnowledgeBases,
  getRestrictedKnowledgeBaseIds,
  getUseLevelKnowledgeBaseIds,
} from './index';

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
  const next = () => {
    const promise = Promise.resolve(results[call++] ?? []);
    // Support the optional trailing `.limit(n)` some helpers chain on.
    return Object.assign(promise, { limit: () => promise });
  };
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: next }),
        leftJoin: () => ({ where: next }),
        where: next,
      }),
    }),
  } as unknown as LobeChatDatabase;
};

/**
 * Fake drizzle db that also records each chain's rendered `where` clause.
 * `dbWithResults` ignores predicates, so it cannot tell a query that filters
 * on a column from one that forgot to.
 */
const dbCapturingWhere = (...results: unknown[][]) => {
  const clauses: string[] = [];
  const dialect = new PgDialect();
  let call = 0;
  const next = (condition?: SQL) => {
    clauses.push(condition ? dialect.sqlToQuery(condition).sql : '');
    const promise = Promise.resolve(results[call++] ?? []);
    return Object.assign(promise, { limit: () => promise });
  };
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: next }),
        leftJoin: () => ({ where: next }),
        where: next,
      }),
    }),
  } as unknown as LobeChatDatabase;

  return { clauses, db };
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

  it('drops KBs the caller holds an edit collaborator grant on', async () => {
    const ctx = {
      // 1st select: restriction rows; 2nd select: the caller's edit grants
      serverDB: dbWithResults([{ id: 'kb-1' }, { id: 'kb-2' }], [{ resourceId: 'kb-1' }]),
      userId: 'collaborator',
      workspaceId: 'ws-1',
    };

    await expect(getRestrictedKnowledgeBaseIds(ctx)).resolves.toEqual(['kb-2']);
  });

  it('keeps the restriction when the caller has no collaborator grant', async () => {
    const ctx = {
      serverDB: dbWithResults([{ id: 'kb-1' }], []),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(getRestrictedKnowledgeBaseIds(ctx)).resolves.toEqual(['kb-1']);
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

describe('assertContentsNotInRestrictedKnowledgeBase', () => {
  it('passes through in personal mode and for empty id lists', async () => {
    const personal = { serverDB: dbWithResults([{ id: 'kb-1' }]), userId: 'u1' };
    await expect(
      assertContentsNotInRestrictedKnowledgeBase(personal, ['file-1']),
    ).resolves.toBeUndefined();

    const ws = { serverDB: dbWithResults([{ id: 'kb-1' }]), userId: 'u1', workspaceId: 'ws-1' };
    await expect(assertContentsNotInRestrictedKnowledgeBase(ws, [])).resolves.toBeUndefined();
  });

  it('passes when no knowledge base is restricted', async () => {
    const ctx = {
      // 1st select: restriction rows (empty)
      serverDB: dbWithResults([]),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(
      assertContentsNotInRestrictedKnowledgeBase(ctx, ['file-1', 'docs_1']),
    ).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when a file id belongs to a restricted KB', async () => {
    const ctx = {
      // 1st select: restriction rows; 2nd: the caller's collaborator grants
      // (none); 3rd: restricted file membership hit
      serverDB: dbWithResults([{ id: 'kb-1' }], [], [{ fileId: 'file-1' }]),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(assertContentsNotInRestrictedKnowledgeBase(ctx, ['file-1'])).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
  });

  it('throws FORBIDDEN when a parsed-file docs_* id links to a restricted KB via fileId', async () => {
    const ctx = {
      // 1st select: restriction rows; 2nd: collaborator grants (none); 3rd:
      // document hit through the fileId → knowledge_base_files membership
      // (knowledgeBaseId null)
      serverDB: dbWithResults([{ id: 'kb-1' }], [], [{ id: 'docs_parsed' }]),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(
      assertContentsNotInRestrictedKnowledgeBase(ctx, ['docs_parsed']),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws FORBIDDEN when a docs_* id belongs to a restricted KB', async () => {
    const ctx = {
      // 1st select: restriction rows; 2nd: collaborator grants (none); 3rd:
      // restricted document hit
      serverDB: dbWithResults([{ id: 'kb-1' }], [], [{ id: 'docs_1' }]),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(assertContentsNotInRestrictedKnowledgeBase(ctx, ['docs_1'])).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
  });

  it('passes when neither files nor documents match a restricted KB', async () => {
    const ctx = {
      // restriction rows, collaborator grants (none), empty file hit, empty
      // document hit
      serverDB: dbWithResults([{ id: 'kb-1' }], [], [], []),
      userId: 'member',
      workspaceId: 'ws-1',
    };

    await expect(
      assertContentsNotInRestrictedKnowledgeBase(ctx, ['file-open', 'docs_open']),
    ).resolves.toBeUndefined();
  });
});

describe('workspace-wide subject scoping', () => {
  // `resource_permissions` is polymorphic on `user_id`: NULL carries the
  // workspace-wide level, a set value carries one member's collaborator grant.
  // A grant reaching these scans would restrict the knowledge base for
  // everyone, so both direct reads must pin the workspace-wide subject.
  const workspaceWide = '"resource_permissions"."user_id" is null';

  it('getUseLevelKnowledgeBaseIds reads only the workspace-wide rows', async () => {
    const { clauses, db } = dbCapturingWhere();

    await getUseLevelKnowledgeBaseIds(db, 'ws-1');

    expect(clauses[0]).toContain(workspaceWide);
  });

  it('getRestrictedKnowledgeBaseIds reads only the workspace-wide rows', async () => {
    const { clauses, db } = dbCapturingWhere([{ id: 'kb-1' }]);

    await getRestrictedKnowledgeBaseIds({ serverDB: db, userId: 'member', workspaceId: 'ws-1' });

    expect(clauses[0]).toContain(workspaceWide);
  });
});
