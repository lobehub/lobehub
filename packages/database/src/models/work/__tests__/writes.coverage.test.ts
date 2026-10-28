// @vitest-environment node
import type { RegisterExternalWorkParams } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, users, works, workspaces, workVersions } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { createProxyTestDB } from '../../__tests__/_proxyTestDB';
import { WorkModel } from '..';
import { registerWorkVersion } from '../writes';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'work-writes-cov-user';
const otherUserId = 'work-writes-cov-other';
const workspaceId = 'work-writes-cov-workspace';

const externalParams = (
  overrides: Partial<RegisterExternalWorkParams> = {},
): RegisterExternalWorkParams => ({
  changeType: 'created',
  resourceId: 'LOB-writes-1',
  resourceType: 'linear_issue',
  title: 'Writes coverage issue',
  toolIdentifier: 'linear',
  toolName: 'save_issue',
  ...overrides,
});

const identity = {
  resourceId: 'LOB-writes-direct',
  resourceType: 'linear_issue' as const,
  type: 'external' as const,
  userId,
  visibility: 'private' as const,
};

const versionParams = {
  changeType: 'created' as const,
  toolCallId: 'call-writes-direct',
  toolIdentifier: 'linear',
  toolName: 'save_issue',
};

const display = {
  content: null,
  description: null,
  identifier: 'LOB-writes-direct',
  status: null,
  title: 'Direct registration',
  url: null,
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('registerWorkVersion · retry classification', () => {
  it('retries a non-Error unique violation and stores null metadata when none is built', async () => {
    const buildInput = vi
      .fn()
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValue({ display });

    const work = await registerWorkVersion(
      { db: serverDB, userId },
      identity,
      versionParams,
      buildInput,
    );

    expect(buildInput).toHaveBeenCalledTimes(2);
    const versions = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ metadata: null, title: 'Direct registration', version: 1 });
  });

  it('rethrows a non-Error failure that is not a unique violation without retrying', async () => {
    const buildInput = vi.fn().mockRejectedValue('upstream exploded');

    await expect(
      registerWorkVersion({ db: serverDB, userId }, identity, versionParams, buildInput),
    ).rejects.toBe('upstream exploded');

    expect(buildInput).toHaveBeenCalledTimes(1);
    // The failed transaction rolled back the freshly inserted identity row.
    expect(
      await serverDB.select().from(works).where(eq(works.resourceId, identity.resourceId)),
    ).toEqual([]);
  });
});

describe('registerWorkVersion · identity guards', () => {
  it('appends a new version on every call when no toolCallId dedupes it', async () => {
    const model = new WorkModel(serverDB, userId);

    const first = await model.registerExternal(externalParams());
    const second = await model.registerExternal(externalParams({ title: 'Renamed' }));

    expect(second?.id).toBe(first?.id);
    const versions = await serverDB
      .select({ toolCallId: workVersions.toolCallId, version: workVersions.version })
      .from(workVersions)
      .where(eq(workVersions.workId, first!.id))
      .orderBy(workVersions.version);
    expect(versions).toEqual([
      { toolCallId: null, version: 1 },
      { toolCallId: null, version: 2 },
    ]);
  });

  it('refuses to adopt a teammate’s private Work for the same workspace resource', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Writes coverage workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    const owner = new WorkModel(serverDB, userId, workspaceId);
    const teammate = new WorkModel(serverDB, otherUserId, workspaceId);

    const original = await owner.registerExternal(externalParams({ toolCallId: 'call-owner' }));

    await expect(
      teammate.registerExternal(externalParams({ title: 'Hijacked', toolCallId: 'call-mate' })),
    ).rejects.toThrow('Failed to resolve external Work identity');

    const [row] = await serverDB.select().from(works).where(eq(works.id, original!.id));
    expect(row).toMatchObject({ title: 'Writes coverage issue', userId });
    expect(
      await serverDB.select().from(workVersions).where(eq(workVersions.workId, original!.id)),
    ).toHaveLength(1);
  });
});

describe('registerWorkVersion · rows that vanish mid-transaction', () => {
  /**
   * pg-proxy has no transaction support, so the transaction callback runs on a
   * proxy over the real connection; the rewrite simulates a concurrent delete
   * landing between the identity upsert and the statement under test.
   */
  const runTransactionOn = (proxyDB: LobeChatDatabase) =>
    vi
      .spyOn(serverDB, 'transaction')
      .mockImplementation(((callback: (tx: LobeChatDatabase) => unknown) =>
        callback(proxyDB)) as never);

  it('throws when the Work row is gone by the time it is locked', async () => {
    runTransactionOn(
      createProxyTestDB(serverDB, (query, result) =>
        /for update/i.test(query) ? [] : result.rows,
      ),
    );

    await expect(
      new WorkModel(serverDB, userId).registerExternal(externalParams({ toolCallId: 'call-lock' })),
    ).rejects.toThrow(/^Work .+ no longer exists$/);
  });

  it('throws when the current-projection update matches no row', async () => {
    runTransactionOn(
      createProxyTestDB(serverDB, (query, result) =>
        /^update "works"/i.test(query) ? [] : result.rows,
      ),
    );

    await expect(
      new WorkModel(serverDB, userId).registerExternal(
        externalParams({ toolCallId: 'call-update' }),
      ),
    ).rejects.toThrow(/^Work .+ no longer exists$/);
  });
});

describe('delete and visibility writes', () => {
  it('leaves Works alone when the document is not visible to the caller', async () => {
    const [doc] = await serverDB
      .insert(documents)
      .values({
        content: 'Body',
        fileType: 'text/markdown',
        source: 'writes-coverage.md',
        sourceType: 'api',
        title: 'Writes coverage doc',
        totalCharCount: 4,
        totalLineCount: 1,
        userId,
      })
      .returning();
    const model = new WorkModel(serverDB, userId);
    const work = await model.registerDocument({
      changeType: 'created',
      documentId: doc.id,
      toolIdentifier: 'lobe-agent-documents',
      toolName: 'createDocument',
    });

    await new WorkModel(serverDB, otherUserId).deleteDocumentWork({ documentId: doc.id });

    expect(await serverDB.select().from(works).where(eq(works.id, work!.id))).toHaveLength(1);
  });

  it('skips the update entirely for an empty task id list', async () => {
    const updateSpy = vi.spyOn(serverDB, 'update');

    await new WorkModel(serverDB, userId).setTaskWorksVisibility([], 'private');

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
