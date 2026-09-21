import { and, asc, count, desc, eq, isNull, or } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import type { AgentEvalBenchmarkItem, AgentEvalTestCaseItem } from '@/database/schemas';
import {
  agentEvalBenchmarks as benchmarks,
  agentEvalDatasets as datasets,
  agentEvalTestCases as cases,
} from '@/database/schemas';

import { BaseService } from '../common/base.service';
import { projectPublicEvalDataset, projectPublicEvalTestCase } from '../helpers/public-fields';
import type {
  CreateBenchmark,
  CreateDataset,
  CreateTestCase,
  EvalPagination,
} from '../types/eval-resource.type';
import { evalPagination } from '../types/eval-resource.type';

export const projectBenchmark = (row: AgentEvalBenchmarkItem) => ({
  id: row.id,
  identifier: row.identifier,
  name: row.name,
  description: row.description,
  rubrics: row.rubrics,
  referenceUrl: row.referenceUrl,
  metadata: row.metadata,
  isSystem: row.isSystem,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
export const projectTestCase = (row: AgentEvalTestCaseItem) => ({
  ...projectPublicEvalTestCase(row),
  input: row.content.input,
  expected: row.content.expected,
  category: row.content.category,
  environment: row.content.environment,
  messages: row.content.messages,
  choices: row.content.choices,
  caseId: row.metadata?.caseId,
});

// Explicit IDs make creates retryable. A duplicate without an ID or with different
// supplied fields is a conflict; it never overwrites an existing resource.
const matches = (row: object, input: object) =>
  Object.entries(input).every(
    ([key, value]) => value === undefined || isEqual(Reflect.get(row, key), value),
  );

export class EvalResourceService extends BaseService {
  private writeError(error: unknown): never {
    const details = error as { code?: string; cause?: { code?: string } };
    const code = details?.code ?? details?.cause?.code;
    if (code === '23505')
      throw this.createConflictError('Eval resource id or identifier already exists');
    if (code === '23503') throw this.createNotFoundError('Referenced eval resource not found');
    throw new Error('Failed to write eval resource', { cause: error });
  }
  private benchmarkRead = () =>
    or(
      this.buildWorkspaceWhere(benchmarks),
      and(isNull(benchmarks.userId), isNull(benchmarks.workspaceId)),
    );
  private datasetRead = () =>
    or(
      this.buildWorkspaceWhere(datasets),
      and(isNull(datasets.userId), isNull(datasets.workspaceId)),
    );

  async getBenchmark(id: string, mutable = false) {
    const [row] = await this.db
      .select()
      .from(benchmarks)
      .where(
        and(
          eq(benchmarks.id, id),
          mutable ? this.buildWorkspaceWhere(benchmarks) : this.benchmarkRead(),
        ),
      )
      .limit(1);
    if (!row) throw this.createNotFoundError('Benchmark not found');
    if (mutable && row.isSystem)
      throw this.createAuthorizationError('System benchmarks are read-only');
    return projectBenchmark(row);
  }
  async listBenchmarks(query: EvalPagination) {
    const { limit, offset } = evalPagination(query);
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(benchmarks)
        .where(this.benchmarkRead())
        .orderBy(desc(benchmarks.createdAt), asc(benchmarks.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(benchmarks).where(this.benchmarkRead()),
    ]);
    return { benchmarks: rows.map(projectBenchmark), total: totals[0].total };
  }
  async createBenchmark(input: CreateBenchmark) {
    const [row] = await this.db
      .insert(benchmarks)
      .values({ ...input, isSystem: false, ...this.buildWorkspacePayload({}) })
      .onConflictDoNothing()
      .returning()
      .catch((error) => this.writeError(error));
    if (row) return projectBenchmark(row);
    if (input.id) {
      const [existing] = await this.db
        .select()
        .from(benchmarks)
        .where(and(eq(benchmarks.id, input.id), this.buildWorkspaceWhere(benchmarks)));
      if (existing && matches(existing, input)) return projectBenchmark(existing);
    }
    throw this.createConflictError('Benchmark id or identifier already exists');
  }
  async updateBenchmark(id: string, input: Partial<Omit<CreateBenchmark, 'id'>>) {
    await this.getBenchmark(id, true);
    const [row] = await this.db
      .update(benchmarks)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(benchmarks.id, id),
          this.buildWorkspaceWhere(benchmarks),
          eq(benchmarks.isSystem, false),
        ),
      )
      .returning()
      .catch((error) => this.writeError(error));
    if (!row) throw this.createNotFoundError('Benchmark not found');
    return projectBenchmark(row);
  }
  async deleteBenchmark(id: string) {
    await this.getBenchmark(id, true);
    await this.db
      .delete(benchmarks)
      .where(
        and(
          eq(benchmarks.id, id),
          this.buildWorkspaceWhere(benchmarks),
          eq(benchmarks.isSystem, false),
        ),
      );
    return { id };
  }
  async getDataset(id: string, mutable = false) {
    const [row] = await this.db
      .select()
      .from(datasets)
      .where(
        and(eq(datasets.id, id), mutable ? this.buildWorkspaceWhere(datasets) : this.datasetRead()),
      )
      .limit(1);
    if (!row) throw this.createNotFoundError('Dataset not found');
    const [total] = await this.db
      .select({ total: count() })
      .from(cases)
      .where(eq(cases.datasetId, id));
    return { ...projectPublicEvalDataset(row), testCaseCount: total.total };
  }
  async listDatasets(query: EvalPagination & { benchmarkId?: string }) {
    const { limit, offset } = evalPagination(query);
    const where = and(
      this.datasetRead(),
      query.benchmarkId ? eq(datasets.benchmarkId, query.benchmarkId) : undefined,
    );
    const [rows, totals] = await Promise.all([
      this.db
        .select({ dataset: datasets, testCaseCount: count(cases.id) })
        .from(datasets)
        .leftJoin(cases, eq(cases.datasetId, datasets.id))
        .where(where)
        .groupBy(datasets.id)
        .orderBy(desc(datasets.createdAt), asc(datasets.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(datasets).where(where),
    ]);
    return {
      datasets: rows.map((row) => ({
        ...projectPublicEvalDataset(row.dataset),
        testCaseCount: row.testCaseCount,
      })),
      total: totals[0].total,
    };
  }
  async createDataset(input: CreateDataset) {
    if (input.benchmarkId) await this.getBenchmark(input.benchmarkId);
    const [row] = await this.db
      .insert(datasets)
      .values({ ...input, ...this.buildWorkspacePayload({}) })
      .onConflictDoNothing()
      .returning()
      .catch((error) => this.writeError(error));
    if (row) return this.getDataset(row.id);
    if (input.id) {
      const [existing] = await this.db
        .select()
        .from(datasets)
        .where(and(eq(datasets.id, input.id), this.buildWorkspaceWhere(datasets)));
      if (existing && matches(existing, input)) return this.getDataset(existing.id);
    }
    throw this.createConflictError('Dataset id or identifier already exists');
  }
  async updateDataset(id: string, input: Partial<Omit<CreateDataset, 'id'>>) {
    await this.getDataset(id, true);
    if (input.benchmarkId) await this.getBenchmark(input.benchmarkId);
    const [row] = await this.db
      .update(datasets)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(datasets.id, id), this.buildWorkspaceWhere(datasets)))
      .returning()
      .catch((error) => this.writeError(error));
    if (!row) throw this.createNotFoundError('Dataset not found');
    return this.getDataset(row.id);
  }
  async deleteDataset(id: string) {
    await this.getDataset(id, true);
    await this.db
      .delete(datasets)
      .where(and(eq(datasets.id, id), this.buildWorkspaceWhere(datasets)));
    return { id };
  }
  async getTestCase(id: string, mutable = false) {
    const [row] = await this.db
      .select({ testCase: cases })
      .from(cases)
      .innerJoin(datasets, eq(cases.datasetId, datasets.id))
      .where(
        and(
          eq(cases.id, id),
          mutable
            ? and(this.buildWorkspaceWhere(cases), this.buildWorkspaceWhere(datasets))
            : this.datasetRead(),
        ),
      )
      .limit(1);
    if (!row) throw this.createNotFoundError('Test case not found');
    return projectTestCase(row.testCase);
  }
  async listTestCases(datasetId: string, query: EvalPagination) {
    await this.getDataset(datasetId);
    const { limit, offset } = evalPagination(query);
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(cases)
        .where(eq(cases.datasetId, datasetId))
        .orderBy(asc(cases.sortOrder), asc(cases.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(cases).where(eq(cases.datasetId, datasetId)),
    ]);
    return { testCases: rows.map(projectTestCase), total: totals[0].total };
  }
  async createTestCase(datasetId: string, input: CreateTestCase) {
    await this.getDataset(datasetId, true);
    const { id, caseId, sortOrder, evalMode, evalConfig, ...content } = input;
    const value = {
      id,
      datasetId,
      content,
      sortOrder: sortOrder ?? 0,
      evalMode,
      evalConfig,
      metadata: caseId ? { caseId } : null,
    };
    const [row] = await this.db
      .insert(cases)
      .values({ ...value, ...this.buildWorkspacePayload({}) })
      .onConflictDoNothing()
      .returning()
      .catch((error) => this.writeError(error));
    if (row) return projectTestCase(row);
    if (id) {
      const [existing] = await this.db
        .select()
        .from(cases)
        .where(and(eq(cases.id, id), this.buildWorkspaceWhere(cases)));
      if (existing && matches(existing, value)) return projectTestCase(existing);
    }
    throw this.createConflictError('Test case id already exists');
  }
  async updateTestCase(id: string, input: Partial<Omit<CreateTestCase, 'id'>>) {
    const existing = await this.getTestCase(id, true);
    const { caseId, sortOrder, evalMode, evalConfig, ...content } = input;
    const [row] = await this.db
      .update(cases)
      .set({
        content: { ...existing.content, ...content },
        sortOrder,
        evalMode,
        evalConfig,
        ...(caseId !== undefined ? { metadata: { ...existing.metadata, caseId } } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(cases.id, id), this.buildWorkspaceWhere(cases)))
      .returning()
      .catch((error) => this.writeError(error));
    if (!row) throw this.createNotFoundError('Test case not found');
    return projectTestCase(row);
  }
  async deleteTestCase(id: string) {
    await this.getTestCase(id, true);
    await this.db.delete(cases).where(and(eq(cases.id, id), this.buildWorkspaceWhere(cases)));
    return { id };
  }
}
