import type {
  AgentEvalExperimentBenchmark,
  AgentEvalExperimentDetail,
  AgentEvalExperimentListItem,
  AgentEvalRunListItem,
} from '@lobechat/types';
import { and, count, desc, eq, getTableColumns, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalExperimentBenchmarks,
  agentEvalExperiments,
  agentEvalRuns,
  type NewAgentEvalExperiment,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { AgentEvalDatasetModel } from './dataset';
import { AgentEvalRunModel } from './run';

const RECENT_RUNS_PER_EXPERIMENT = 5;

export class AgentEvalExperimentModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  private datasetModel: AgentEvalDatasetModel;
  private runModel: AgentEvalRunModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.datasetModel = new AgentEvalDatasetModel(db, userId, workspaceId);
    this.runModel = new AgentEvalRunModel(db, userId, workspaceId);
  }

  private experimentOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentEvalExperiments,
    );

  private junctionOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentEvalExperimentBenchmarks,
    );

  private datasetOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentEvalDatasets);

  private runOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentEvalRuns);

  /** Read predicate for benchmarks: workspace/personal rows + system rows. */
  private benchmarkReadable = () =>
    or(
      buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        agentEvalBenchmarks,
      ),
      isNull(agentEvalBenchmarks.userId),
    );

  private normalizeBenchmarkIds = (benchmarkIds: string[]) => [...new Set(benchmarkIds)];

  private ensureVisibleBenchmarks = async (benchmarkIds: string[]) => {
    if (benchmarkIds.length === 0) return;

    const rows = await this.db
      .select({ id: agentEvalBenchmarks.id })
      .from(agentEvalBenchmarks)
      .where(and(inArray(agentEvalBenchmarks.id, benchmarkIds), this.benchmarkReadable()));

    if (rows.length !== benchmarkIds.length) {
      throw new Error('Benchmarks not found or inaccessible');
    }
  };

  create = async (
    params: Omit<NewAgentEvalExperiment, 'userId' | 'workspaceId'> & {
      benchmarkIds: string[];
    },
  ) => {
    const { benchmarkIds, ...experiment } = params;
    const normalizedBenchmarkIds = this.normalizeBenchmarkIds(benchmarkIds);

    await this.ensureVisibleBenchmarks(normalizedBenchmarkIds);

    // Idempotent create: when the caller supplies an `id` (cross-server machine
    // creation), return the existing experiment instead of failing on conflict.
    if (experiment.id) {
      const [existing] = await this.db
        .select()
        .from(agentEvalExperiments)
        .where(and(eq(agentEvalExperiments.id, experiment.id), this.experimentOwnership()))
        .limit(1);
      if (existing) return existing;
    }

    const insert = async () =>
      this.db.transaction(async (trx) => {
        const [created] = await trx
          .insert(agentEvalExperiments)
          .values({
            ...experiment,
            userId: this.userId,
            workspaceId: this.workspaceId ?? null,
          })
          .returning();

        if (normalizedBenchmarkIds.length > 0) {
          await trx.insert(agentEvalExperimentBenchmarks).values(
            normalizedBenchmarkIds.map((benchmarkId) => ({
              benchmarkId,
              experimentId: created.id,
              userId: this.userId,
              workspaceId: this.workspaceId ?? null,
            })),
          );
        }

        return created;
      });

    try {
      return await insert();
    } catch (error) {
      // Race-safe idempotency: a concurrent insert with the same id lost the
      // race — return the winner's row.
      if (experiment.id && (error as { code?: string })?.code === '23505') {
        const [existing] = await this.db
          .select()
          .from(agentEvalExperiments)
          .where(and(eq(agentEvalExperiments.id, experiment.id), this.experimentOwnership()))
          .limit(1);
        if (existing) return existing;
      }
      throw error;
    }
  };

  /**
   * Delete an experiment, detaching (not deleting) its runs and scoped
   * datasets first so their history is preserved.
   */
  delete = async (id: string) => {
    return this.db.transaction(async (trx) => {
      await trx
        .update(agentEvalRuns)
        .set({ experimentId: null, updatedAt: new Date() })
        .where(and(eq(agentEvalRuns.experimentId, id), this.runOwnership()));

      await trx
        .update(agentEvalDatasets)
        .set({ sourceExperimentId: null, updatedAt: new Date() })
        .where(and(eq(agentEvalDatasets.sourceExperimentId, id), this.datasetOwnership()));

      return trx
        .delete(agentEvalExperiments)
        .where(and(eq(agentEvalExperiments.id, id), this.experimentOwnership()));
    });
  };

  /** Experiment row + its linked benchmarks. */
  private findWithBenchmarks = async (id: string) => {
    const [experiment] = await this.db
      .select()
      .from(agentEvalExperiments)
      .where(and(eq(agentEvalExperiments.id, id), this.experimentOwnership()))
      .limit(1);

    if (!experiment) return undefined;

    const benchmarks = await this.db
      .select({
        id: agentEvalBenchmarks.id,
        description: agentEvalBenchmarks.description,
        identifier: agentEvalBenchmarks.identifier,
        isSystem: agentEvalBenchmarks.isSystem,
        name: agentEvalBenchmarks.name,
      })
      .from(agentEvalExperimentBenchmarks)
      .innerJoin(
        agentEvalBenchmarks,
        eq(agentEvalExperimentBenchmarks.benchmarkId, agentEvalBenchmarks.id),
      )
      .where(
        and(
          eq(agentEvalExperimentBenchmarks.experimentId, id),
          this.junctionOwnership(),
          this.benchmarkReadable(),
        ),
      )
      .orderBy(agentEvalBenchmarks.name);

    return { ...experiment, benchmarks: benchmarks as AgentEvalExperimentBenchmark[] };
  };

  /**
   * Single-payload detail: experiment + linked benchmarks + ALL datasets
   * across those benchmarks (baseline + scoped) + experiment runs.
   * Flat queries only — no N+1.
   */
  findById = async (id: string): Promise<AgentEvalExperimentDetail | undefined> => {
    const base = await this.findWithBenchmarks(id);
    if (!base) return undefined;

    const benchmarkIds = base.benchmarks.map((benchmark) => benchmark.id);

    const [datasets, runs] = await Promise.all([
      benchmarkIds.length > 0 ? this.datasetModel.query({ benchmarkIds }) : [],
      this.runModel.query({ experimentId: id }),
    ]);

    return { ...base, datasets, runs } as AgentEvalExperimentDetail;
  };

  /**
   * List experiments with aggregate counts and a recent-runs preview.
   * Recent runs are fetched for ALL experiments in a single window-function
   * query (ROW_NUMBER per experiment), then grouped in JS — no per-experiment
   * N+1.
   */
  query = async (): Promise<AgentEvalExperimentListItem[]> => {
    const datasetCountSq = this.db
      .select({
        count: count().as('dataset_count'),
        experimentId: agentEvalDatasets.sourceExperimentId,
      })
      .from(agentEvalDatasets)
      .where(this.datasetOwnership())
      .groupBy(agentEvalDatasets.sourceExperimentId)
      .as('dc');

    const runCountSq = this.db
      .select({
        count: count().as('run_count'),
        experimentId: agentEvalRuns.experimentId,
      })
      .from(agentEvalRuns)
      .where(this.runOwnership())
      .groupBy(agentEvalRuns.experimentId)
      .as('rc');

    const benchmarkCountSq = this.db
      .select({
        count: count().as('benchmark_count'),
        experimentId: agentEvalExperimentBenchmarks.experimentId,
      })
      .from(agentEvalExperimentBenchmarks)
      .where(this.junctionOwnership())
      .groupBy(agentEvalExperimentBenchmarks.experimentId)
      .as('bc');

    const rows = await this.db
      .select({
        accessedAt: agentEvalExperiments.accessedAt,
        benchmarkCount: benchmarkCountSq.count,
        createdAt: agentEvalExperiments.createdAt,
        datasetCount: datasetCountSq.count,
        description: agentEvalExperiments.description,
        id: agentEvalExperiments.id,
        metadata: agentEvalExperiments.metadata,
        name: agentEvalExperiments.name,
        runCount: runCountSq.count,
        updatedAt: agentEvalExperiments.updatedAt,
        userId: agentEvalExperiments.userId,
      })
      .from(agentEvalExperiments)
      .leftJoin(datasetCountSq, eq(agentEvalExperiments.id, datasetCountSq.experimentId))
      .leftJoin(runCountSq, eq(agentEvalExperiments.id, runCountSq.experimentId))
      .leftJoin(benchmarkCountSq, eq(agentEvalExperiments.id, benchmarkCountSq.experimentId))
      .where(this.experimentOwnership())
      .orderBy(desc(agentEvalExperiments.accessedAt), desc(agentEvalExperiments.updatedAt));

    const experimentIds = rows.map((row) => row.id);

    const benchmarkRows =
      experimentIds.length === 0
        ? []
        : await this.db
            .select({
              benchmarkId: agentEvalBenchmarks.id,
              benchmarkName: agentEvalBenchmarks.name,
              experimentId: agentEvalExperimentBenchmarks.experimentId,
            })
            .from(agentEvalExperimentBenchmarks)
            .innerJoin(
              agentEvalBenchmarks,
              eq(agentEvalExperimentBenchmarks.benchmarkId, agentEvalBenchmarks.id),
            )
            .where(
              and(
                this.junctionOwnership(),
                inArray(agentEvalExperimentBenchmarks.experimentId, experimentIds),
                this.benchmarkReadable(),
              ),
            )
            .orderBy(agentEvalBenchmarks.name);

    const benchmarkMap = new Map<string, AgentEvalExperimentBenchmark[]>();

    for (const row of benchmarkRows) {
      const list = benchmarkMap.get(row.experimentId) || [];
      list.push({ id: row.benchmarkId, name: row.benchmarkName });
      benchmarkMap.set(row.experimentId, list);
    }

    // Recent runs (≤5 per experiment) in ONE window-function query, then a
    // single batched dataset lookup for names — no N+1, no join collision.
    const recentRunsMap = new Map<string, AgentEvalRunListItem[]>();

    if (experimentIds.length > 0) {
      const rankedRuns = this.db
        .select({
          ...getTableColumns(agentEvalRuns),
          rn: sql<number>`row_number() over (partition by ${agentEvalRuns.experimentId} order by ${agentEvalRuns.createdAt} desc)`.as(
            'rn',
          ),
        })
        .from(agentEvalRuns)
        .where(and(this.runOwnership(), inArray(agentEvalRuns.experimentId, experimentIds)))
        .as('ranked_runs');

      const recentRunRows = await this.db
        .select()
        .from(rankedRuns)
        .where(sql`${rankedRuns.rn} <= ${RECENT_RUNS_PER_EXPERIMENT}`);

      const datasetIds = [...new Set(recentRunRows.map((row) => row.datasetId))];
      const datasetRows =
        datasetIds.length === 0
          ? []
          : await this.db
              .select({
                benchmarkId: agentEvalDatasets.benchmarkId,
                id: agentEvalDatasets.id,
                name: agentEvalDatasets.name,
              })
              .from(agentEvalDatasets)
              .where(inArray(agentEvalDatasets.id, datasetIds));
      const datasetMap = new Map(datasetRows.map((dataset) => [dataset.id, dataset]));

      for (const row of recentRunRows) {
        if (!row.experimentId) continue;
        const { rn: _rn, ...run } = row;
        const dataset = datasetMap.get(row.datasetId);
        const list = recentRunsMap.get(row.experimentId) || [];
        list.push({
          ...(run as unknown as AgentEvalRunListItem),
          benchmarkId: dataset?.benchmarkId,
          datasetName: dataset?.name,
        });
        recentRunsMap.set(row.experimentId, list);
      }
    }

    return rows.map((row) => ({
      ...row,
      benchmarkCount: Number(row.benchmarkCount) || 0,
      benchmarks: benchmarkMap.get(row.id) || [],
      datasetCount: Number(row.datasetCount) || 0,
      recentRuns: recentRunsMap.get(row.id) || [],
      runCount: Number(row.runCount) || 0,
    })) as AgentEvalExperimentListItem[];
  };

  /** Reverse lookup: which experiments are linked to the given benchmarks. */
  findByBenchmarkIds = async (benchmarkIds: string[]) => {
    if (benchmarkIds.length === 0) return [];

    return this.db
      .select({
        benchmarkId: agentEvalExperimentBenchmarks.benchmarkId,
        experimentId: agentEvalExperiments.id,
        experimentName: agentEvalExperiments.name,
      })
      .from(agentEvalExperimentBenchmarks)
      .innerJoin(
        agentEvalExperiments,
        eq(agentEvalExperimentBenchmarks.experimentId, agentEvalExperiments.id),
      )
      .where(
        and(
          this.junctionOwnership(),
          inArray(agentEvalExperimentBenchmarks.benchmarkId, benchmarkIds),
        ),
      )
      .orderBy(desc(agentEvalExperiments.updatedAt));
  };

  touch = async (id: string) => {
    const [result] = await this.db
      .update(agentEvalExperiments)
      .set({ accessedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentEvalExperiments.id, id), this.experimentOwnership()))
      .returning();

    return result;
  };

  update = async (
    id: string,
    params: Partial<Omit<NewAgentEvalExperiment, 'id' | 'userId' | 'workspaceId'>> & {
      benchmarkIds?: string[];
    },
  ) => {
    const { benchmarkIds, ...value } = params;
    const normalizedBenchmarkIds = benchmarkIds
      ? this.normalizeBenchmarkIds(benchmarkIds)
      : undefined;

    if (normalizedBenchmarkIds) {
      await this.ensureVisibleBenchmarks(normalizedBenchmarkIds);
    }

    return this.db.transaction(async (trx) => {
      const [updated] = await trx
        .update(agentEvalExperiments)
        .set({ ...value, updatedAt: new Date() })
        .where(and(eq(agentEvalExperiments.id, id), this.experimentOwnership()))
        .returning();

      if (!updated) return undefined;

      if (normalizedBenchmarkIds) {
        await trx
          .delete(agentEvalExperimentBenchmarks)
          .where(and(eq(agentEvalExperimentBenchmarks.experimentId, id), this.junctionOwnership()));

        if (normalizedBenchmarkIds.length > 0) {
          await trx.insert(agentEvalExperimentBenchmarks).values(
            normalizedBenchmarkIds.map((benchmarkId) => ({
              benchmarkId,
              experimentId: id,
              userId: this.userId,
              workspaceId: this.workspaceId ?? null,
            })),
          );
        }
      }

      return updated;
    });
  };
}
