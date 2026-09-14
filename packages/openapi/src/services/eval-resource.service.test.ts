import { beforeAll, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { users, workspaces } from '@/database/schemas';

import {
  CreateBenchmarkSchema,
  CreateTestCaseSchema,
  EvalPaginationSchema,
} from '../types/eval-resource.type';
import { EvalResourceService } from './eval-resource.service';

const db = await getTestDB();
const owner = new EvalResourceService(db, 'eval-api-owner', 'eval-api-workspace');
const member = new EvalResourceService(db, 'eval-api-member', 'eval-api-workspace');
const outsider = new EvalResourceService(db, 'eval-api-outsider');
beforeAll(async () => {
  await db
    .insert(users)
    .values(['eval-api-owner', 'eval-api-member', 'eval-api-outsider'].map((id) => ({ id })));
  await db.insert(workspaces).values({
    id: 'eval-api-workspace',
    name: 'Eval API',
    primaryOwnerId: 'eval-api-owner',
    slug: 'eval-api-workspace',
  });
});

describe('public eval resources', () => {
  it('round trips structured cases, paginates, isolates and supports ID replay', async () => {
    const input = {
      id: 'benchmark-api',
      identifier: 'benchmark-api',
      name: 'Public benchmark',
      rubrics: [],
    };
    const benchmark = await owner.createBenchmark(input);
    expect(benchmark).not.toHaveProperty('userId');
    expect(await owner.createBenchmark(input)).toEqual(benchmark);
    await expect(owner.createBenchmark({ ...input, name: 'conflict' })).rejects.toMatchObject({
      name: 'ConflictError',
    });
    await expect(outsider.getBenchmark(benchmark.id)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    expect(await member.getBenchmark(benchmark.id)).toEqual(benchmark);
    const dataset = await owner.createDataset({
      id: 'dataset-api',
      identifier: 'dataset-api',
      name: 'Cases',
      benchmarkId: benchmark.id,
      evalMode: 'external',
    });
    const content = {
      id: 'case-api',
      input: 'Question',
      expected: 'Answer',
      caseId: 'native-1',
      messages: [{ content: 'Context', role: 'user' as const }],
      environment: { envPrompt: 'Environment' },
    };
    const testCase = await owner.createTestCase(dataset.id, content);
    expect(await owner.createTestCase(dataset.id, content)).toEqual(testCase);
    expect(testCase).toMatchObject(content);
    expect(testCase).not.toHaveProperty('workspaceId');
    await owner.createTestCase(dataset.id, { input: 'Second' });
    expect(await owner.listTestCases(dataset.id, { limit: 1, offset: 1 })).toMatchObject({
      total: 2,
      testCases: [{ input: 'Second' }],
    });
    expect(await owner.getDataset(dataset.id)).toMatchObject({ testCaseCount: 2 });
    await expect(
      outsider.createTestCase(dataset.id, { input: 'Cross-scope' }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(
      outsider.createDataset({
        identifier: 'foreign-parent',
        name: 'Invalid',
        benchmarkId: benchmark.id,
      }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(await member.updateTestCase(testCase.id, { expected: 'Updated' })).toMatchObject({
      input: 'Question',
      expected: 'Updated',
      messages: content.messages,
    });
    await member.deleteTestCase(testCase.id);
    await expect(owner.getTestCase(testCase.id)).rejects.toMatchObject({ name: 'NotFoundError' });
    await owner.deleteDataset(dataset.id);
    await owner.deleteBenchmark(benchmark.id);
  });
  it('rejects paths in messages and unbounded pagination', () => {
    expect(
      CreateTestCaseSchema.safeParse({ input: 'x', messages: '/tmp/history.json' }).success,
    ).toBe(false);
    for (const input of [{ limit: '101' }, { limit: '1.5' }, { offset: '-1' }])
      expect(EvalPaginationSchema.safeParse(input).success).toBe(false);
  });
  it('retains advanced rubric configuration instead of stripping evaluator options', () => {
    const input = {
      identifier: 'rubrics',
      name: 'Rubrics',
      rubrics: [
        {
          id: 'similar',
          name: 'Similarity',
          type: 'similar',
          weight: 1,
          config: { value: 'answer', threshold: 0.8 },
        },
        {
          id: 'llm',
          name: 'Judge',
          type: 'llm-rubric',
          weight: 1,
          config: { criteria: 'Correct', systemRole: 'Judge carefully' },
        },
        {
          id: 'any',
          name: 'Any',
          type: 'any-of',
          weight: 1,
          config: { values: ['A'], caseSensitive: false },
        },
        {
          id: 'extract',
          name: 'Extract',
          type: 'extract-match',
          weight: 1,
          extractor: { type: 'last-line', trim: true },
          config: {
            extractor: { type: 'regex', pattern: '(A)', group: 1 },
            innerMatcher: 'equals',
          },
        },
      ],
    };
    expect(CreateBenchmarkSchema.parse(input)).toEqual(input);
  });
});
