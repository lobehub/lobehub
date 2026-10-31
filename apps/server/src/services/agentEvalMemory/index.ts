import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import type { EvalMemoryFixture, EvalMemoryReference, EvalMemorySnapshot } from '@lobechat/types';
import { and, asc, eq, isNull } from 'drizzle-orm';

import {
  agentEvalMemories,
  agentEvalRuns,
  agentEvalRunTopics,
  threads,
  topics,
} from '@/database/schemas';
import { evalMemoryFixtureSchema } from '@/server/services/agentEvalRun/evalMemory.schema';
import { getEvalAttemptId } from '@/server/services/agentEvalRun/utils';
import type { ToolExecutionMemoryEmbeddingRuntime } from '@/server/services/toolExecution/types';

import { createEvalMemoryEmbedder, embedWithRetry } from './embedding';
import { draftText, fixtureDrafts, toEntry } from './entries';
import { attemptWhere, EvalMemoryRuntimeService } from './runtime';

export interface EvalMemoryTrial {
  runId: string;
  testCaseId: string;
  threadId?: string;
  topicId: string;
}

const fixtureDigest = (value: unknown): string => {
  const normalize = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(normalize)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : item;
  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
};

export const EMPTY_FIXTURE_HASH = fixtureDigest({});

/**
 * Memory of eval attempts, kept apart from the account's own Memory: each
 * attempt (a run's topic, or one pass@k thread of it) gets its own entries,
 * seeded from the case fixture before the Agent runs. The Memory tool and
 * the persona injection of the attempt read and write only those entries;
 * the caller stays the actor for authentication, billing and ownership.
 * Entries are evidence: nothing is deleted when the attempt ends.
 */
export class AgentEvalMemoryService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /**
   * Seed the attempt's Memory from the fixture, once. A resumed attempt keeps
   * what it had (and what the Agent wrote) and must bring the same fixture.
   */
  async prepare(
    params: EvalMemoryTrial & { fixture: EvalMemoryFixture },
  ): Promise<EvalMemoryReference> {
    const fixture = evalMemoryFixtureSchema.parse(params.fixture);
    const fixtureHash = fixtureDigest(fixture);
    const reference: EvalMemoryReference = {
      fixtureHash,
      runId: params.runId,
      ...(params.threadId && { threadId: params.threadId }),
      topicId: params.topicId,
    };
    const drafts = fixtureDrafts(fixture);
    // Embeddings before the lock: the provider call is the slow part.
    const embeddings =
      drafts.length > 0
        ? await embedWithRetry(
            createEvalMemoryEmbedder({
              db: this.db,
              source: 'evalMemory:seed',
              userId: this.userId,
              workspaceId: this.workspaceId,
            }),
            drafts.map(draftText),
          )
        : [];

    // Hold the attempt's run topic until the seed is committed, so concurrent
    // workflow deliveries never see half a fixture or seed it twice.
    return this.db.transaction(async (tx) => {
      const [trial] = await tx
        .select({ topicId: agentEvalRunTopics.topicId })
        .from(agentEvalRunTopics)
        .innerJoin(agentEvalRuns, eq(agentEvalRuns.id, agentEvalRunTopics.runId))
        .innerJoin(topics, eq(topics.id, agentEvalRunTopics.topicId))
        .where(
          and(
            eq(agentEvalRunTopics.runId, params.runId),
            eq(agentEvalRunTopics.testCaseId, params.testCaseId),
            eq(agentEvalRunTopics.topicId, params.topicId),
            eq(agentEvalRunTopics.userId, this.userId),
            eq(agentEvalRuns.userId, this.userId),
            eq(topics.userId, this.userId),
            eq(topics.trigger, 'eval'),
            this.workspaceId
              ? eq(agentEvalRuns.workspaceId, this.workspaceId)
              : isNull(agentEvalRuns.workspaceId),
          ),
        )
        .for('update', { of: agentEvalRunTopics });
      if (!trial) throw new Error('Eval Memory trial not found or not owned by caller');

      if (params.threadId) {
        const [thread] = await tx
          .select({ id: threads.id })
          .from(threads)
          .where(
            and(
              eq(threads.id, params.threadId),
              eq(threads.topicId, params.topicId),
              eq(threads.userId, this.userId),
            ),
          );
        if (!thread) throw new Error('Eval Memory thread does not belong to this trial');
      }

      const [seeded] = await tx
        .select({ fixtureHash: agentEvalMemories.fixtureHash })
        .from(agentEvalMemories)
        .where(
          and(
            attemptWhere(this.userId, reference, { includeRemoved: true }),
            eq(agentEvalMemories.source, 'fixture'),
          ),
        )
        .limit(1);
      if (seeded) {
        if (seeded.fixtureHash !== fixtureHash)
          throw new Error('Cannot change Memory fixture while resuming a trial');
        return reference;
      }
      if (drafts.length === 0) return reference;

      const capturedAt = fixture.seededAt ? new Date(fixture.seededAt) : new Date();
      await tx.insert(agentEvalMemories).values(
        drafts.map((draft, index) => ({
          ...draft,
          attemptId: getEvalAttemptId(reference),
          capturedAt,
          embedding: embeddings[index] ?? null,
          fixtureHash,
          runId: params.runId,
          source: 'fixture' as const,
          threadId: params.threadId ?? null,
          topicId: params.topicId,
          userId: this.userId,
        })),
      );
      return reference;
    });
  }

  /**
   * The reference must name the attempt the caller is executing: a pass@k
   * thread resolves only from that thread, a topic-level attempt from its
   * topic and any of its sub-agent threads.
   */
  private assertContext(
    reference: EvalMemoryReference,
    context: { threadId?: string | null; topicId?: string | null },
  ) {
    if (!context.topicId || context.topicId !== reference.topicId)
      throw new Error('Eval Memory belongs to another trial');
    if (reference.threadId && context.threadId && reference.threadId !== context.threadId)
      throw new Error('Eval Memory belongs to another attempt of this trial');
  }

  /** The persona the attempt's prompt is built from (the fixture's, never the caller's). */
  async getPersonaDocument(
    reference: EvalMemoryReference,
    context: { threadId?: string | null; topicId?: string | null },
  ): Promise<{ persona: string; tagline?: string | null; version: number } | undefined> {
    this.assertContext(reference, context);
    const [row] = await this.db
      .select({ summary: agentEvalMemories.summary, title: agentEvalMemories.title })
      .from(agentEvalMemories)
      .where(and(attemptWhere(this.userId, reference), eq(agentEvalMemories.layer, 'persona')))
      .orderBy(asc(agentEvalMemories.createdAt))
      .limit(1);
    if (!row?.summary) return undefined;
    return { persona: row.summary, tagline: row.title, version: 0 };
  }

  /** The Memory tool of the attempt. */
  runtime(options: {
    memoryEffort: 'high' | 'low' | 'medium';
    memoryEmbeddingRuntime?: ToolExecutionMemoryEmbeddingRuntime;
    reference: EvalMemoryReference;
    context: { threadId?: string | null; topicId?: string | null };
  }) {
    this.assertContext(options.reference, options.context);
    return new EvalMemoryRuntimeService({
      db: this.db,
      embed: createEvalMemoryEmbedder({
        db: this.db,
        memoryEmbeddingRuntime: options.memoryEmbeddingRuntime,
        source: 'evalMemory:tool',
        userId: this.userId,
        workspaceId: this.workspaceId,
      }),
      memoryEffort: options.memoryEffort,
      reference: options.reference,
      userId: this.userId,
    });
  }

  /** Everything the attempt's Memory holds, removed entries included, oldest first. */
  async snapshot(
    trial: Pick<EvalMemoryTrial, 'runId' | 'threadId' | 'topicId'>,
  ): Promise<EvalMemorySnapshot> {
    const rows = await this.db
      .select()
      .from(agentEvalMemories)
      .where(attemptWhere(this.userId, trial, { includeRemoved: true }))
      .orderBy(asc(agentEvalMemories.capturedAt), asc(agentEvalMemories.createdAt));
    const fixtureHash = rows.find((row) => row.fixtureHash)?.fixtureHash ?? EMPTY_FIXTURE_HASH;
    return { attemptId: getEvalAttemptId(trial), entries: rows.map(toEntry), fixtureHash };
  }
}

export { EvalMemoryRuntimeService } from './runtime';
