// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documents,
  files,
  globalFiles,
  users,
  verifyCriteria,
  verifyRubricCriteria,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyCriterionModel } from '../verifyCriterion';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-criterion-edge-user';
const otherUserId = 'verify-criterion-edge-other';

const model = new VerifyCriterionModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(files);
  await serverDB.delete(globalFiles);
  await serverDB.delete(verifyRubricCriteria);
  await serverDB.delete(verifyCriteria);
  await serverDB.delete(documents);
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

const createDocument = async (id: string, content: string | null, ownerId = userId) => {
  await serverDB.insert(documents).values({
    content,
    fileType: 'text/plain',
    id,
    source: 'test',
    sourceType: 'api',
    title: `Doc ${id}`,
    totalCharCount: content?.length ?? 0,
    totalLineCount: 1,
    userId: ownerId,
  });
};

const baseItem = (overrides: Record<string, unknown>) =>
  ({
    id: 'edge-check',
    index: 0,
    onFail: 'manual',
    required: true,
    title: 'Edge check',
    verifierConfig: {},
    verifierType: 'agent',
    ...overrides,
  }) as any;

describe('VerifyCriterionModel short-circuits', () => {
  it('returns an empty list when no ids are given to findByIds', async () => {
    await expect(model.findByIds([])).resolves.toEqual([]);
  });

  it('returns an empty list when no ids are given to forkRubricCriteria', async () => {
    await expect(model.forkRubricCriteria([])).resolves.toEqual([]);
  });

  it('keeps task-local ids untouched when no rubric links them', async () => {
    const local = await model.create({ title: 'local', verifierType: 'agent' });
    const other = await model.create({ title: 'other', verifierType: 'agent' });

    await expect(model.forkRubricCriteria([local.id, other.id])).resolves.toEqual([
      local.id,
      other.id,
    ]);
  });
});

describe('VerifyCriterionModel.query filters', () => {
  it('hides archived criteria unless includeArchived is set', async () => {
    const archived = await model.create({ title: 'archived', verifierType: 'llm' });
    await model.create({ title: 'live', verifierType: 'llm' });
    await model.update(archived.id, { archivedAt: new Date() });

    const defaultTitles = (await model.query()).map((row) => row.title);
    expect(defaultTitles).not.toContain('archived');
    expect(defaultTitles).toContain('live');

    const allTitles = (await model.query({ includeArchived: true })).map((row) => row.title);
    expect(allTitles).toEqual(expect.arrayContaining(['archived', 'live']));
  });

  it('escapes LIKE wildcards in the search term', async () => {
    await model.create({ title: '100% done', verifierType: 'llm' });
    await model.create({ title: '100x done', verifierType: 'llm' });
    await model.create({ title: 'a_b', verifierType: 'llm' });
    await model.create({ title: 'axb', verifierType: 'llm' });
    await model.create({ title: 'a\\b', verifierType: 'llm' });

    await expect(model.query({ search: '100%' })).resolves.toHaveLength(1);
    await expect(model.query({ search: 'a_b' })).resolves.toHaveLength(1);
    await expect(model.query({ search: 'a\\b' })).resolves.toHaveLength(1);
  });

  it('matches every tag in the filter', async () => {
    await model.create({ tags: ['smoke', 'fast'], title: 'tagged', verifierType: 'llm' });
    await model.create({ tags: ['smoke'], title: 'single', verifierType: 'llm' });

    await expect(model.query({ tags: ['smoke'] })).resolves.toHaveLength(2);
    await expect(model.query({ tags: ['smoke', 'fast'] })).resolves.toHaveLength(1);
    await expect(model.query({ tags: ['smoke', 'missing'] })).resolves.toHaveLength(0);
  });
});

describe('VerifyCriterionModel.materialize resources', () => {
  it('freezes the document content referenced by the item', async () => {
    await createDocument('edge-doc', 'document body');

    const [result] = await model.materialize(
      [baseItem({ documentId: 'edge-doc', id: 'doc-check' })],
      'delivery-doc',
    );

    expect(result.resourceSnapshot).toEqual({
      documentContent: 'document body',
      fixtures: [],
    });
  });

  it('falls back to an empty string for a document without content', async () => {
    await createDocument('edge-doc-empty', null);

    const [result] = await model.materialize(
      [baseItem({ documentId: 'edge-doc-empty', id: 'empty-doc-check' })],
      'delivery-doc',
    );

    expect(result.resourceSnapshot?.documentContent).toBe('');
  });

  it('rejects an item pointing at a document outside the caller scope', async () => {
    await createDocument('foreign-doc', 'secret', otherUserId);

    await expect(
      model.materialize(
        [baseItem({ documentId: 'foreign-doc', id: 'missing-doc-check' })],
        'delivery-doc',
      ),
    ).rejects.toThrow('Check document unavailable');
  });

  it('skips fixtures without a resource binding', async () => {
    const [result] = await model.materialize(
      [
        baseItem({
          definition: { fixtures: [{ id: 'f', name: 'Input' }] },
          id: 'no-resource-check',
        }),
      ],
      'delivery-doc',
    );

    expect(result.resourceSnapshot).toEqual({ fixtures: [] });
  });

  it('freezes the hash and url of a file fixture', async () => {
    await serverDB.insert(globalFiles).values({
      creator: userId,
      fileType: 'text/plain',
      hashId: 'edge-hash',
      size: 3,
      url: 'https://example.com/f.txt',
    });
    await serverDB.insert(files).values({
      fileHash: 'edge-hash',
      fileType: 'text/plain',
      id: 'edge-file',
      name: 'f.txt',
      size: 3,
      url: 'https://example.com/f.txt',
      userId,
    });

    const [result] = await model.materialize(
      [
        baseItem({
          definition: {
            fixtures: [{ id: 'f', name: 'Input', resource: { id: 'edge-file', type: 'file' } }],
          },
          id: 'file-check',
        }),
      ],
      'delivery-doc',
    );

    expect(result.resourceSnapshot?.fixtures).toEqual([
      { fileHash: 'edge-hash', fixtureId: 'f', url: 'https://example.com/f.txt' },
    ]);
  });

  it('rejects a file fixture without an immutable hash', async () => {
    await serverDB.insert(files).values({
      fileType: 'text/plain',
      id: 'edge-file-nohash',
      name: 'f.txt',
      size: 3,
      url: 'https://example.com/f.txt',
      userId,
    });

    await expect(
      model.materialize(
        [
          baseItem({
            definition: {
              fixtures: [
                { id: 'f', name: 'Input', resource: { id: 'edge-file-nohash', type: 'file' } },
              ],
            },
            id: 'nohash-check',
          }),
        ],
        'delivery-doc',
      ),
    ).rejects.toThrow('Fixture requires an immutable file hash');
  });

  it('derives a legacy definition from the item verifier config', async () => {
    const criterion = await model.create({
      title: 'legacy',
      verifierConfig: {},
      verifierType: 'agent',
    });

    const [result] = await model.materialize(
      [
        baseItem({
          id: 'legacy-check',
          sourceCriterionId: criterion.id,
          verifierConfig: { expected: 'panel visible', method: 'click the button' },
        }),
      ],
      'delivery-legacy',
    );

    expect(result.definition).toEqual({
      expected: 'panel visible',
      steps: [{ id: 'legacy-method', instruction: 'click the button' }],
    });
  });

  it('leaves the derived definition empty when the criterion has no hints', async () => {
    const criterion = await model.create({
      title: 'bare',
      verifierConfig: {},
      verifierType: 'agent',
    });

    const [result] = await model.materialize(
      [baseItem({ id: 'bare-check', sourceCriterionId: criterion.id })],
      'delivery-bare',
    );

    expect(result.definition?.expected).toBeUndefined();
    expect(result.definition?.steps).toBeUndefined();
  });
});

describe('VerifyCriterionModel.update definitions', () => {
  it('validates the definition before writing', async () => {
    const criterion = await model.create({ title: 'update', verifierType: 'agent' });

    await model.update(criterion.id, { definition: { expected: 'new' } });
    expect((await model.findById(criterion.id))?.definition).toEqual({ expected: 'new' });

    await expect(
      model.update(criterion.id, { definition: { steps: 'nope' } as any }),
    ).rejects.toThrow();
  });
});
