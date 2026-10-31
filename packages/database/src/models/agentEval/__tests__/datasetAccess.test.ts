import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { retireLobeBenchCases } from '../../../../../../scripts/seedLobeBench/retireCases';
import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import { AgentEvalDatasetModel } from '../dataset';
import { AgentEvalDatasetWriteError } from '../datasetAccess';
import { AgentEvalTestCaseModel, isRetiredEvalTestCase } from '../testCase';

const db = await getTestDB();
const userId = 'data-integrity-user';
const otherUserId = 'data-integrity-other';
const workspaceId = 'data-integrity-workspace';
const otherWorkspaceId = 'data-integrity-other-workspace';
const datasets = new AgentEvalDatasetModel(db, userId);
const cases = new AgentEvalTestCaseModel(db, userId);
const fixedMetadata = { custom: true, kind: 'lobe-bench', release: 'release-v1' };

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(workspaces).values([
    { id: workspaceId, name: 'Workspace', primaryOwnerId: userId, slug: workspaceId },
    {
      id: otherWorkspaceId,
      name: 'Other workspace',
      primaryOwnerId: otherUserId,
      slug: otherWorkspaceId,
    },
  ]);
});

afterEach(async () => {
  await db.delete(agentEvalRunTopics);
  await db.delete(agentEvalRuns);
  await db.delete(topics);
  await db.delete(agentEvalTestCases);
  await db.delete(agentEvalDatasets);
  await db.delete(agentEvalEnvironments);
  await db.delete(workspaces);
  await db.delete(users);
});

const newDataset = (identifier = 'own', metadata?: Record<string, unknown>) =>
  datasets.create({ identifier, metadata, name: identifier });

describe('case parent authorization', () => {
  it('rejects foreign, system, missing and cross-workspace parents without inserting', async () => {
    const own = await newDataset();
    const rows = await db
      .insert(agentEvalDatasets)
      .values([
        { identifier: 'foreign', name: 'Foreign', userId: otherUserId },
        { identifier: 'system', name: 'System', userId: null },
        { identifier: 'own-workspace', name: 'Workspace', userId, workspaceId },
      ])
      .returning();
    for (const datasetId of [...rows.map((row) => row.id), 'missing']) {
      await expect(
        cases.create({ content: { input: 'Blocked' }, datasetId }),
      ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
      await expect(
        cases.batchCreate([
          { content: { input: 'Should roll back too' }, datasetId: own.id },
          { content: { input: 'Blocked' }, datasetId },
        ]),
      ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    }
    expect(await db.select().from(agentEvalTestCases)).toEqual([]);
  });

  it('allows workspace collaborators while rejecting personal, other-workspace and system parents', async () => {
    const workspaceCases = new AgentEvalTestCaseModel(db, userId, workspaceId);
    const [shared, foreignWorkspace, personal, system] = await db
      .insert(agentEvalDatasets)
      .values([
        { identifier: 'shared', name: 'Shared', userId: otherUserId, workspaceId },
        { identifier: 'foreign-workspace', name: 'Foreign', userId, workspaceId: otherWorkspaceId },
        { identifier: 'personal', name: 'Personal', userId },
        { identifier: 'system-workspace', name: 'System', userId: null, workspaceId },
      ])
      .returning();
    const added = await workspaceCases.create({
      content: { input: 'Shared case' },
      datasetId: shared.id,
      workspaceId: otherWorkspaceId,
    });
    expect(added).toMatchObject({ userId, workspaceId });
    for (const row of [foreignWorkspace, personal, system]) {
      await expect(
        workspaceCases.create({ content: { input: 'Blocked' }, datasetId: row.id }),
      ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    }
  });

  it('normalizes blank workspace scopes consistently for parent lookup and insertion', async () => {
    const own = await newDataset();
    const result = await new AgentEvalTestCaseModel(db, userId, '  ').create({
      content: { input: 'Personal' },
      datasetId: own.id,
    });
    expect(result.workspaceId).toBeNull();
    expect(await cases.batchCreate([])).toEqual([]);
  });

  it('rejects unreadable environment references in every case write path', async () => {
    const own = await newDataset();
    const [foreign, ownEnvironment, system] = await db
      .insert(agentEvalEnvironments)
      .values([
        { config: {}, name: 'Foreign', userId: otherUserId },
        { config: {}, name: 'Own', userId },
        { config: {}, name: 'System', userId: null },
      ])
      .returning();
    const first = await cases.create({
      content: { input: 'Own environment' },
      datasetId: own.id,
      environmentId: ownEnvironment.id,
    });
    await cases.create({
      content: { input: 'System environment' },
      datasetId: own.id,
      environmentId: system.id,
    });
    await expect(
      cases.create({ content: { input: 'Blocked' }, datasetId: own.id, environmentId: foreign.id }),
    ).rejects.toThrow('Environment not found or not readable');
    await expect(
      cases.batchCreate([
        { content: { input: 'Would be valid' }, datasetId: own.id },
        { content: { input: 'Blocked' }, datasetId: own.id, environmentId: foreign.id },
      ]),
    ).rejects.toThrow('Environment not found or not readable');
    await expect(cases.update(first.id, { environmentId: foreign.id })).rejects.toThrow(
      'Environment not found or not readable',
    );
    await expect(
      datasets.create({ identifier: 'blocked-copy', name: 'Blocked' }, [
        { content: { input: 'Blocked' }, environmentId: foreign.id },
      ]),
    ).rejects.toThrow('Environment not found or not readable');
    expect(await cases.countByDatasetId(own.id)).toBe(2);
    expect((await datasets.queryList()).map((row) => row.id)).toEqual([own.id]);
  });

  it('accepts a collaborator environment only in the matching workspace', async () => {
    const workspaceDatasets = new AgentEvalDatasetModel(db, userId, workspaceId);
    const [shared, foreign] = await db
      .insert(agentEvalEnvironments)
      .values([
        { config: {}, name: 'Shared', userId: otherUserId, workspaceId },
        { config: {}, name: 'Foreign workspace', userId, workspaceId: otherWorkspaceId },
      ])
      .returning();
    const dataset = await workspaceDatasets.create({ identifier: 'shared-copy', name: 'Shared' }, [
      { content: { input: 'Shared' }, environmentId: shared.id },
    ]);
    expect((await workspaceDatasets.findById(dataset.id))?.testCases[0].workspaceId).toBe(
      workspaceId,
    );
    await expect(
      workspaceDatasets.create({ identifier: 'foreign-copy', name: 'Foreign' }, [
        { content: { input: 'Foreign' }, environmentId: foreign.id },
      ]),
    ).rejects.toThrow('Environment not found or not readable');
  });
});

describe('fixed Lobe Bench datasets', () => {
  it('supports the legacy first batch, then rejects additions, edits and individual deletions', async () => {
    const dataset = await newDataset('fixed', fixedMetadata);
    const [first] = await cases.batchCreate([
      { content: { input: 'First' }, datasetId: dataset.id },
      { content: { input: 'Second' }, datasetId: dataset.id },
    ]);
    await expect(
      cases.create({ content: { input: 'Extra' }, datasetId: dataset.id }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await expect(
      cases.batchCreate([{ content: { input: 'Extra' }, datasetId: dataset.id }]),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await expect(cases.update(first.id, { content: { input: 'Changed' } })).rejects.toBeInstanceOf(
      AgentEvalDatasetWriteError,
    );
    await expect(cases.delete(first.id)).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    expect((await datasets.findById(dataset.id))?.testCases).toHaveLength(2);
  });

  it('allows only one concurrent initial fill', async () => {
    const dataset = await newDataset('concurrent', fixedMetadata);
    const results = await Promise.allSettled([
      cases.batchCreate([{ content: { input: 'First' }, datasetId: dataset.id }]),
      cases.batchCreate([{ content: { input: 'Second' }, datasetId: dataset.id }]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await cases.countByDatasetId(dataset.id)).toBe(1);
  });

  it('preserves identity, version and grading configuration while allowing renaming', async () => {
    const dataset = await newDataset('fixed', fixedMetadata);
    for (const metadata of [
      {},
      { ...fixedMetadata, custom: false },
      { ...fixedMetadata, release: 'v2' },
    ]) {
      await expect(datasets.update(dataset.id, { metadata })).rejects.toBeInstanceOf(
        AgentEvalDatasetWriteError,
      );
    }
    await expect(datasets.update(dataset.id, { evalMode: 'regex' })).rejects.toBeInstanceOf(
      AgentEvalDatasetWriteError,
    );
    const renamed = await datasets.update(dataset.id, {
      description: 'A fixed selection',
      metadata: { ...fixedMetadata },
      name: 'Renamed',
    });
    expect(renamed).toMatchObject({ metadata: fixedMetadata, name: 'Renamed' });
  });

  it('creates the dataset and its initial copied cases atomically and freezes the copies', async () => {
    const dataset = await datasets.create(
      { identifier: 'atomic', metadata: fixedMetadata, name: 'Atomic' },
      [{ content: { input: 'Copied' }, metadata: { source: 'library' } }],
    );
    const [copied] = (await datasets.findById(dataset.id))!.testCases;
    expect(copied).toMatchObject({ content: { input: 'Copied' }, sortOrder: 1, userId });
    await expect(cases.update(copied.id, { content: { input: 'Changed' } })).rejects.toBeInstanceOf(
      AgentEvalDatasetWriteError,
    );
    await expect(
      datasets.create({ identifier: 'failed-copy', metadata: fixedMetadata, name: 'Failed' }, [
        { content: { input: 'First copy' }, id: 'duplicate-case-id' },
        { content: { input: 'Conflicting copy' }, id: 'duplicate-case-id' },
      ]),
    ).rejects.toThrow();
    expect((await datasets.queryList()).map((row) => row.identifier)).toEqual(['atomic']);
  });

  it('keeps ordinary Eval Lab editing and explicit dataset deletion available', async () => {
    const dataset = await newDataset('lab');
    const first = await cases.create({ content: { input: 'First' }, datasetId: dataset.id });
    const second = await cases.create({ content: { input: 'Second' }, datasetId: dataset.id });
    expect(await cases.update(first.id, { content: { input: 'Edited' } })).toMatchObject({
      content: { input: 'Edited' },
    });
    await cases.delete(second.id);
    expect(await cases.countByDatasetId(dataset.id)).toBe(1);
    const fixed = await datasets.create(
      { identifier: 'fixed', metadata: fixedMetadata, name: 'Fixed' },
      [{ content: { input: 'Copy' } }],
    );
    await datasets.delete(fixed.id);
    expect(await datasets.findById(fixed.id)).toBeUndefined();
  });
});

describe('seed retirement preserves execution evidence', () => {
  it('keeps run topics, hides retired rows from catalog reads, and can reactivate the same id', async () => {
    const [dataset] = await db
      .insert(agentEvalDatasets)
      .values({
        identifier: 'system',
        name: 'System',
        userId: null,
      })
      .returning();
    const [stale, active] = await db
      .insert(agentEvalTestCases)
      .values([
        {
          content: { input: 'Old' },
          datasetId: dataset.id,
          metadata: { caseId: 'old' },
          userId: null,
        },
        {
          content: { input: 'Current' },
          datasetId: dataset.id,
          metadata: { caseId: 'current' },
          userId: null,
        },
      ])
      .returning();
    const [run] = await db
      .insert(agentEvalRuns)
      .values({ datasetId: dataset.id, name: 'History', userId })
      .returning();
    const [topic] = await db.insert(topics).values({ userId, title: 'History' }).returning();
    const [result] = await db
      .insert(agentEvalRunTopics)
      .values({
        evalResult: { externalResult: { passed: true, reason: 'Saved judge evidence', score: 1 } },
        passed: true,
        runId: run.id,
        score: 1,
        status: 'passed',
        testCaseId: stale.id,
        topicId: topic.id,
        userId,
      })
      .returning();

    await db.transaction((tx) => retireLobeBenchCases(tx, [stale.id]));
    expect(await db.select().from(agentEvalRunTopics)).toEqual([result]);
    expect(isRetiredEvalTestCase((await cases.findById(stale.id))!)).toBe(true);
    expect((await cases.findByDatasetId(dataset.id)).map((row) => row.id)).toEqual([active.id]);
    expect(await cases.countByDatasetId(dataset.id)).toBe(1);
    expect(await cases.findByDatasetIdAndCaseId(dataset.id, 'old')).toBeUndefined();
    expect((await datasets.findById(dataset.id))?.testCases.map((row) => row.id)).toEqual([
      active.id,
    ]);
    expect((await datasets.query())[0].testCaseCount).toBe(1);

    // The ordinary seed upsert replaces metadata for cases that return to the Release.
    await db
      .update(agentEvalTestCases)
      .set({ metadata: { caseId: 'old' } })
      .where(eq(agentEvalTestCases.id, stale.id));
    expect(await cases.countByDatasetId(dataset.id)).toBe(2);
    expect(await db.select().from(agentEvalRunTopics)).toEqual([result]);
  });
});
