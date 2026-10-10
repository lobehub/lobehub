import { eq } from 'drizzle-orm';
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  users,
  verifyCriteria,
  verifyRubricCriteria,
  verifyRubrics,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyCriterionModel } from '../verifyCriterion';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-criterion-test-user';
const otherUserId = 'verify-criterion-test-other-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(verifyRubricCriteria);
  await serverDB.delete(verifyRubrics);
  await serverDB.delete(verifyCriteria);
  await serverDB.delete(users);
});

describe('VerifyCriterionModel', () => {
  it('creates a criterion scoped to the user', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const created = await model.create({
      title: 'type-check passes',
      verifierConfig: { command: 'pnpm type-check' },
      verifierType: 'program',
    });

    expect(created).toMatchObject({
      onFail: 'manual',
      required: true,
      title: 'type-check passes',
      userId,
      verifierType: 'program',
    });
    expect(created.id).toBeDefined();
  });

  it('lists only the current user criteria', async () => {
    const mine = new VerifyCriterionModel(serverDB, userId);
    const other = new VerifyCriterionModel(serverDB, otherUserId);
    await mine.create({ title: 'a', verifierType: 'llm' });
    await other.create({ title: 'b', verifierType: 'llm' });

    const list = await mine.query();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('a');
  });

  it('resolves a set of ids via findByIds (user-scoped)', async () => {
    const mine = new VerifyCriterionModel(serverDB, userId);
    const other = new VerifyCriterionModel(serverDB, otherUserId);
    const a = await mine.create({ title: 'a', verifierType: 'llm' });
    const b = await mine.create({ title: 'b', verifierType: 'agent' });
    const leaked = await other.create({ title: 'leaked', verifierType: 'llm' });

    const resolved = await mine.findByIds([a.id, b.id, leaked.id]);
    expect(resolved.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('forks rubric criteria while preserving task-local criterion identities', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const shared = await model.create({ title: 'shared', verifierType: 'llm' });
    const local = await model.create({ title: 'local', verifierType: 'agent' });
    const [rubric] = await serverDB
      .insert(verifyRubrics)
      .values({ title: 'template', userId })
      .returning();
    await serverDB.insert(verifyRubricCriteria).values({
      criterionId: shared.id,
      rubricId: rubric.id,
      userId,
    });

    const [forkedId, localId] = await model.forkRubricCriteria([shared.id, local.id]);

    expect(forkedId).not.toBe(shared.id);
    expect(localId).toBe(local.id);
    expect(await model.findById(forkedId)).toMatchObject({
      title: shared.title,
      verifierType: shared.verifierType,
    });

    await model.update(forkedId, { title: 'task edit' });
    expect(await model.findById(shared.id)).toMatchObject({ title: 'shared' });
  });

  it('forks a workspace rubric criterion authored by another member', async () => {
    const workspaceId = 'verify-criterion-workspace';
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Verify workspace',
      primaryOwnerId: otherUserId,
      slug: workspaceId,
    });
    const author = new VerifyCriterionModel(serverDB, otherUserId, workspaceId);
    const editor = new VerifyCriterionModel(serverDB, userId, workspaceId);
    const shared = await author.create({ title: 'workspace shared', verifierType: 'llm' });
    const [rubric] = await serverDB
      .insert(verifyRubrics)
      .values({ title: 'workspace template', userId: otherUserId, workspaceId })
      .returning();
    await serverDB.insert(verifyRubricCriteria).values({
      criterionId: shared.id,
      rubricId: rubric.id,
      userId: otherUserId,
      workspaceId,
    });

    const [forkedId] = await editor.forkRubricCriteria([shared.id]);

    expect(forkedId).not.toBe(shared.id);
    expect(await editor.findById(forkedId)).toMatchObject({
      title: 'workspace shared',
      userId,
      workspaceId,
    });
  });

  it('updates and deletes', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const c = await model.create({ title: 'old', verifierType: 'llm' });

    await model.update(c.id, { required: false, title: 'new' });
    expect(await model.findById(c.id)).toMatchObject({ required: false, title: 'new' });

    await model.delete(c.id);
    expect(await model.findById(c.id)).toBeUndefined();
  });
});

describe('check assets', () => {
  it('automatically persists generated checks idempotently without merging other deliveries', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const item = {
      id: 'check-1',
      index: 0,
      title: 'Send message',
      required: true,
      onFail: 'manual' as const,
      verifierType: 'agent' as const,
      verifierConfig: {},
      definition: { expected: 'Message displayed' },
    };
    const [first] = await model.materialize([item], 'delivery-a');
    const [retry] = await model.materialize([item], 'delivery-a');
    const [different] = await model.materialize([item], 'delivery-b');
    expect(first.sourceCriterionId).toBe(retry.sourceCriterionId);
    expect(different.sourceCriterionId).not.toBe(first.sourceCriterionId);
    expect(await model.query()).toHaveLength(2);
    await model.update(first.sourceCriterionId!, { archivedAt: new Date() });
    expect(await model.query()).toHaveLength(1);
    expect(await model.findById(first.sourceCriterionId!)).toBeDefined();
  });

  it('rejects malformed fixture links and references to another owner assets', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    await expect(
      model.create({
        title: 'Invalid',
        verifierType: 'agent',
        definition: { steps: [{ id: 'step', instruction: 'Run', fixtureIds: ['missing'] }] },
      }),
    ).rejects.toThrow('Unknown fixture');
    const foreign = await new VerifyCriterionModel(serverDB, otherUserId).create({
      title: 'Private',
      verifierType: 'agent',
    });
    await expect(
      model.materialize(
        [
          {
            id: 'x',
            index: 0,
            title: 'Private',
            required: true,
            onFail: 'manual',
            verifierType: 'agent',
            verifierConfig: {},
            sourceCriterionId: foreign.id,
          },
        ],
        'delivery',
      ),
    ).rejects.toThrow('current scope');
  });
});

describe('frozen resources', () => {
  it('freezes document fixture content and refuses unavailable resource references', async () => {
    const { documents } = await import('../../schemas');
    const [doc] = await serverDB
      .insert(documents)
      .values({
        id: 'asset-fixture-doc',
        userId,
        title: 'Fixture',
        sourceType: 'api',
        source: 'test',
        fileType: 'text/plain',
        totalCharCount: 16,
        totalLineCount: 1,
        content: 'original fixture',
      })
      .returning();
    const model = new VerifyCriterionModel(serverDB, userId);
    const item = {
      id: 'fixture-check',
      index: 0,
      title: 'Fixture check',
      required: true,
      onFail: 'manual' as const,
      verifierType: 'agent' as const,
      verifierConfig: {},
      definition: {
        fixtures: [{ id: 'f', name: 'Input', resource: { type: 'document' as const, id: doc.id } }],
      },
    };
    const [first] = await model.materialize([item], 'delivery');
    await serverDB
      .update(documents)
      .set({ content: 'updated fixture' })
      .where(eq(documents.id, doc.id));
    const [replay] = await model.materialize([first], 'delivery');
    const [fresh] = await model.materialize([item], 'delivery');
    expect(replay.resourceSnapshot?.fixtures[0].content).toBe('original fixture');
    expect(fresh.resourceSnapshot?.fixtures[0].content).toBe('updated fixture');
    await serverDB.delete(documents).where(eq(documents.id, doc.id));
    await expect(model.materialize([item], 'delivery')).rejects.toThrow(
      'Fixture document unavailable',
    );
  });
});

describe('query filters and empty-id guards', () => {
  it('returns early for empty id sets', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    expect(await model.findByIds([])).toEqual([]);
    expect(await model.forkRubricCriteria([])).toEqual([]);
  });

  it('filters by archived, search and tags', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const alpha = await model.create({
      title: 'Alpha widget',
      verifierType: 'llm',
      tags: ['a', 'b'],
    });
    const beta = await model.create({ title: 'Beta widget', verifierType: 'llm', tags: ['b'] });
    await model.update(beta.id, { archivedAt: new Date() });

    // archived rows are hidden by default and included on request
    expect((await model.query()).map((c) => c.id)).toEqual([alpha.id]);
    expect((await model.query({ includeArchived: true })).map((c) => c.id).sort()).toEqual(
      [alpha.id, beta.id].sort(),
    );

    // search is scoped and the wildcard is escaped
    expect((await model.query({ search: 'Alpha' })).map((c) => c.id)).toEqual([alpha.id]);
    expect(await model.query({ search: '%' })).toHaveLength(0);

    // tags use array containment
    expect((await model.query({ tags: ['a'] })).map((c) => c.id)).toEqual([alpha.id]);
  });

  it('returns the original ids when nothing is rubric-mounted', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const a = await model.create({ title: 'a', verifierType: 'llm' });
    const b = await model.create({ title: 'b', verifierType: 'agent' });
    expect(await model.forkRubricCriteria([a.id, b.id])).toEqual([a.id, b.id]);
  });
});

describe('materialize derived definitions and fixtures', () => {
  it('derives a legacy definition from verifierConfig when none is supplied', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const [item] = await model.materialize(
      [
        {
          id: 'legacy',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'Legacy check',
          verifierConfig: { expected: 'panel visible', method: 'open the panel' },
          verifierType: 'llm',
        },
      ],
      'delivery',
    );
    expect(item.definition).toEqual({
      expected: 'panel visible',
      steps: [{ id: 'legacy-method', instruction: 'open the panel' }],
    });
    expect(item.resourceSnapshot).toEqual({ fixtures: [] });
  });

  it('snapshots the item document content and rejects an unresolvable document', async () => {
    const { documents } = await import('../../schemas');
    const [doc] = await serverDB
      .insert(documents)
      .values({
        id: 'criterion-snapshot-doc',
        userId,
        title: 'Rubric body',
        sourceType: 'api',
        source: 'test',
        fileType: 'text/plain',
        totalCharCount: 5,
        totalLineCount: 1,
        content: 'hello',
      })
      .returning();
    const [emptyDoc] = await serverDB
      .insert(documents)
      .values({
        id: 'criterion-empty-doc',
        userId,
        title: 'Empty',
        sourceType: 'api',
        source: 'test',
        fileType: 'text/plain',
        totalCharCount: 0,
        totalLineCount: 0,
        content: null,
      })
      .returning();
    const model = new VerifyCriterionModel(serverDB, userId);

    const [withContent] = await model.materialize(
      [
        {
          id: 'doc-check',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'Doc check',
          documentId: doc.id,
          verifierConfig: {},
          verifierType: 'llm',
        },
      ],
      'delivery',
    );
    expect(withContent.resourceSnapshot?.documentContent).toBe('hello');

    // a document with no content snapshots as an empty string
    const [emptyContent] = await model.materialize(
      [
        {
          id: 'empty-doc-check',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'Empty doc check',
          documentId: emptyDoc.id,
          verifierConfig: {},
          verifierType: 'llm',
        },
      ],
      'delivery',
    );
    expect(emptyContent.resourceSnapshot?.documentContent).toBe('');

    // a criterion pointing at another owner's document cannot be snapshotted
    const [foreignDoc] = await serverDB
      .insert(documents)
      .values({
        id: 'criterion-foreign-doc',
        userId: otherUserId,
        title: 'Foreign body',
        sourceType: 'api',
        source: 'test',
        fileType: 'text/plain',
        totalCharCount: 1,
        totalLineCount: 1,
        content: 'secret',
      })
      .returning();
    const foreignOwned = await model.create({
      title: 'foreign body check',
      verifierType: 'llm',
      documentId: foreignDoc.id,
    });
    await expect(
      model.materialize(
        [
          {
            id: 'foreign-doc-check',
            index: 0,
            onFail: 'manual',
            required: true,
            title: 'Foreign doc check',
            sourceCriterionId: foreignOwned.id,
            verifierConfig: {},
            verifierType: 'llm',
          },
        ],
        'delivery',
      ),
    ).rejects.toThrow('Check document unavailable');
  });

  it('skips resource-less fixtures and freezes file fixtures', async () => {
    const { globalFiles, files } = await import('../../schemas');
    await serverDB.insert(globalFiles).values({
      hashId: 'criterion-file-hash',
      fileType: 'text/plain',
      size: 3,
      url: 'https://example.com/asset.txt',
      creator: userId,
    });
    await serverDB.insert(files).values({
      id: 'criterion-file-1',
      userId,
      fileType: 'text/plain',
      fileHash: 'criterion-file-hash',
      name: 'asset.txt',
      size: 3,
      url: 'https://example.com/asset.txt',
    });
    await serverDB.insert(files).values({
      id: 'criterion-file-no-hash',
      userId,
      fileType: 'text/plain',
      fileHash: null,
      name: 'loose.txt',
      size: 3,
      url: 'https://example.com/loose.txt',
    });
    const model = new VerifyCriterionModel(serverDB, userId);

    const [skipped] = await model.materialize(
      [
        {
          id: 'skip-fixture',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'No resource',
          verifierConfig: {},
          verifierType: 'llm',
          definition: { fixtures: [{ id: 'f-skip', name: 'No resource' }] },
        },
      ],
      'delivery',
    );
    expect(skipped.resourceSnapshot?.fixtures).toEqual([]);

    const [frozen] = await model.materialize(
      [
        {
          id: 'file-fixture',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'File fixture',
          verifierConfig: {},
          verifierType: 'llm',
          definition: {
            fixtures: [
              { id: 'f-file', name: 'Input', resource: { type: 'file', id: 'criterion-file-1' } },
            ],
          },
        },
      ],
      'delivery',
    );
    expect(frozen.resourceSnapshot?.fixtures).toEqual([
      {
        fixtureId: 'f-file',
        fileHash: 'criterion-file-hash',
        url: 'https://example.com/asset.txt',
      },
    ]);

    await expect(
      model.materialize(
        [
          {
            id: 'file-nohash',
            index: 0,
            onFail: 'manual',
            required: true,
            title: 'Loose file',
            verifierConfig: {},
            verifierType: 'llm',
            definition: {
              fixtures: [
                {
                  id: 'f-loose',
                  name: 'Loose',
                  resource: { type: 'file', id: 'criterion-file-no-hash' },
                },
              ],
            },
          },
        ],
        'delivery',
      ),
    ).rejects.toThrow('Fixture requires an immutable file hash');
  });

  it('validates a definition on update', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const c = await model.create({ title: 'editable', verifierType: 'llm' });
    await model.update(c.id, { definition: { expected: 'updated' } });
    expect((await model.findById(c.id))?.definition).toEqual({ expected: 'updated' });
  });
});

describe('materialize document fixtures', () => {
  it('freezes a document fixture with no stored content as an empty string', async () => {
    const { documents } = await import('../../schemas');
    const [doc] = await serverDB
      .insert(documents)
      .values({
        id: 'criterion-fixture-empty-doc',
        userId,
        title: 'Empty fixture',
        sourceType: 'api',
        source: 'test',
        fileType: 'text/plain',
        totalCharCount: 0,
        totalLineCount: 0,
        content: null,
      })
      .returning();
    const model = new VerifyCriterionModel(serverDB, userId);
    const [item] = await model.materialize(
      [
        {
          id: 'empty-fixture-check',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'Empty fixture check',
          verifierConfig: {},
          verifierType: 'llm',
          definition: {
            fixtures: [
              { id: 'f-empty', name: 'Empty', resource: { type: 'document', id: doc.id } },
            ],
          },
        },
      ],
      'delivery',
    );
    expect(item.resourceSnapshot?.fixtures).toEqual([{ fixtureId: 'f-empty', content: '' }]);
  });
});
