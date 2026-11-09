import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalTestCases,
  users,
} from '../../../schemas';
import { AgentEvalDatasetModel } from '../dataset';
import { AgentEvalDatasetWriteError } from '../datasetAccess';
import { AgentEvalTestCaseModel } from '../testCase';

const db = await getTestDB();
const userId = 'dataset-freeze-user';
const datasets = new AgentEvalDatasetModel(db, userId);
const cases = new AgentEvalTestCaseModel(db, userId);
let lobeBenchId: string;
let labId: string;

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  const [bench, lab] = await db
    .insert(agentEvalBenchmarks)
    .values([
      {
        identifier: 'lobe-bench',
        isSystem: true,
        metadata: { kind: 'lobe-bench' },
        name: 'Lobe Bench',
        rubrics: [],
        userId: null,
      },
      { identifier: 'lab', isSystem: false, name: 'Lab', rubrics: [], userId },
    ])
    .returning();
  lobeBenchId = bench.id;
  labId = lab.id;
});

afterEach(async () => {
  await db.delete(agentEvalTestCases);
  await db.delete(agentEvalDatasets);
  await db.delete(agentEvalBenchmarks);
  await db.delete(users);
});

describe('server-derived Lobe Bench dataset freezing', () => {
  it.each([
    undefined,
    { kind: 'lobe-bench' },
    { custom: false, kind: 'lobe-bench' },
    { custom: false, kind: 'eval-lab' },
  ])('freezes an atomic API creation under Lobe Bench with metadata %o', async (metadata) => {
    // createDataset accepts optional metadata and passes it straight to this model.
    const dataset = await datasets.create(
      { benchmarkId: lobeBenchId, identifier: 'api-created', metadata, name: 'API created' },
      [{ content: { input: 'Original' } }],
    );
    expect(dataset).toMatchObject({ metadata: { custom: true, kind: 'lobe-bench' }, userId });
    expect((await datasets.query({ benchmarkId: lobeBenchId })).map((row) => row.id)).toContain(
      dataset.id,
    );
    const [testCase] = (await datasets.findById(dataset.id))!.testCases;
    await expect(
      cases.update(testCase.id, { content: { input: 'Changed' } }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await expect(datasets.update(dataset.id, { metadata: {} })).rejects.toBeInstanceOf(
      AgentEvalDatasetWriteError,
    );
  });

  it('allows the first fill of an unmarked empty dataset, then freezes it', async () => {
    const dataset = await datasets.create({
      benchmarkId: lobeBenchId,
      identifier: 'empty',
      name: 'Empty',
    });
    const [first] = await cases.batchCreate([
      { content: { input: 'First' }, datasetId: dataset.id },
    ]);
    expect(first).toBeDefined();
    await expect(
      cases.batchCreate([{ content: { input: 'Extra' }, datasetId: dataset.id }]),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    expect(await cases.countByDatasetId(dataset.id)).toBe(1);
  });

  it('protects legacy unmarked datasets and keeps them frozen after moving out', async () => {
    const [legacy] = await db
      .insert(agentEvalDatasets)
      .values({
        benchmarkId: lobeBenchId,
        identifier: 'legacy',
        name: 'Legacy',
        userId,
      })
      .returning();
    const [testCase] = await db
      .insert(agentEvalTestCases)
      .values({
        content: { input: 'Original' },
        datasetId: legacy.id,
        userId,
      })
      .returning();
    await expect(cases.delete(testCase.id)).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await expect(datasets.update(legacy.id, { evalMode: 'regex' })).rejects.toBeInstanceOf(
      AgentEvalDatasetWriteError,
    );
    const moved = await datasets.update(legacy.id, { benchmarkId: labId, name: 'Moved' });
    expect(moved?.metadata).toMatchObject({ custom: true, kind: 'lobe-bench' });
    await expect(
      cases.update(testCase.id, { content: { input: 'Changed' } }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await expect(datasets.update(legacy.id, { metadata: {} })).rejects.toBeInstanceOf(
      AgentEvalDatasetWriteError,
    );
  });

  it('keeps ordinary Lab editable, then freezes a dataset moved into Lobe Bench', async () => {
    const dataset = await datasets.create(
      { benchmarkId: labId, identifier: 'lab-data', name: 'Lab data' },
      [{ content: { input: 'Original' } }],
    );
    const [first] = (await datasets.findById(dataset.id))!.testCases;
    expect(await cases.update(first.id, { content: { input: 'Editable in Lab' } })).toMatchObject({
      content: { input: 'Editable in Lab' },
    });
    const moved = await datasets.update(dataset.id, { benchmarkId: lobeBenchId });
    expect(moved?.metadata).toMatchObject({ custom: true, kind: 'lobe-bench' });
    await expect(
      cases.create({ content: { input: 'Extra' }, datasetId: dataset.id }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await datasets.update(dataset.id, { benchmarkId: labId });
    await expect(cases.delete(first.id)).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
  });

  it('classifies existing datasets by the current parent kind without granting parent write rights', async () => {
    const dataset = await datasets.create(
      { benchmarkId: labId, identifier: 'reclassified', name: 'Reclassified' },
      [{ content: { input: 'Original' } }],
    );
    await db
      .update(agentEvalBenchmarks)
      .set({ metadata: { kind: 'lobe-bench' } })
      .where(eq(agentEvalBenchmarks.id, labId));
    const [first] = (await datasets.findById(dataset.id))!.testCases;
    await expect(cases.update(first.id, { content: { input: 'Changed' } })).rejects.toBeInstanceOf(
      AgentEvalDatasetWriteError,
    );
    expect((await datasets.update(dataset.id, { name: 'Renamed' }))?.metadata).toMatchObject({
      custom: true,
      kind: 'lobe-bench',
    });
  });

  it('recognizes dataset kind even with a false custom marker and no Lobe Bench parent', async () => {
    const dataset = await datasets.create(
      {
        benchmarkId: labId,
        identifier: 'marked',
        metadata: { custom: false, kind: 'lobe-bench' },
        name: 'Marked',
      },
      [{ content: { input: 'Original' } }],
    );
    await expect(
      cases.create({ content: { input: 'Extra' }, datasetId: dataset.id }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    expect(dataset.metadata).toMatchObject({ custom: true, kind: 'lobe-bench' });
  });

  it('does not turn system datasets into writable or custom user datasets', async () => {
    const [system] = await db
      .insert(agentEvalDatasets)
      .values({
        benchmarkId: lobeBenchId,
        identifier: 'system',
        metadata: { kind: 'lobe-bench' },
        name: 'System',
        userId: null,
      })
      .returning();
    await expect(
      cases.create({ content: { input: 'Injected' }, datasetId: system.id }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    expect(await datasets.update(system.id, { name: 'Changed' })).toBeUndefined();
    expect((await datasets.findById(system.id))?.metadata).toEqual({ kind: 'lobe-bench' });
  });
});
