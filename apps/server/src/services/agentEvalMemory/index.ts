import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  type EvalMemoryFixture,
  type EvalMemoryReference,
  type EvalMemorySnapshot,
  ThreadType,
} from '@lobechat/types';
import { and, asc, eq, sql } from 'drizzle-orm';

import {
  agentEvalMemories,
  agentEvalRuns,
  agentEvalRunTopics,
  messages,
  threads,
  topics,
} from '@/database/schemas';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { evalMemoryFixtureSchema } from '@/server/services/agentEvalRun/evalMemory.schema';
import { getEvalAttemptId } from '@/server/services/agentEvalRun/utils';
import type { ToolExecutionMemoryEmbeddingRuntime } from '@/server/services/toolExecution/types';

import { createEvalMemoryEmbedder, embedOrSkip } from './embedding';
import { fixtureDrafts, semanticText, toEntry } from './entries';
import { EvalMemoryRuntimeService } from './runtime';
import { attemptWhere } from './where';

type MemoryDatabase =
  LobeChatDatabase | Parameters<Parameters<LobeChatDatabase['transaction']>[0]>[0];

/** How deep sub-agents may nest inside one attempt (a sub-agent of a sub-agent …). */
const MAX_SUB_AGENT_DEPTH = 4;

export interface EvalMemoryTrial {
  resume?: boolean;
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

export class EvalMemoryFixtureConflictError extends Error {}

const assertFixture = (
  state: { fixtureHash?: string | null; hasEntries: boolean },
  fixtureHash: string,
  requireInitialized: boolean,
) => {
  if (state.fixtureHash && state.fixtureHash !== fixtureHash)
    throw new EvalMemoryFixtureConflictError('Cannot change Memory fixture while resuming a trial');
  if (!state.fixtureHash && (requireInitialized || state.hasEntries))
    throw new EvalMemoryFixtureConflictError(
      'Memory fixture initialization was not recorded; rerun this case instead of resuming',
    );
};

/**
 * Memory of eval attempts, kept apart from the account's own Memory: each
 * attempt (a run's topic, or one pass@k thread of it) gets its own entries,
 * seeded from the case fixture before the Agent runs. The Memory tool and
 * the persona injection of the attempt read and write only those entries,
 * and the tool searches them as the account's Memory is searched; the
 * caller stays the actor for authorization; the topic's stable creator
 * owns the Memory entries and embedding configuration across collaborators.
 * Entries are evidence: nothing is deleted when the attempt ends.
 */
export class AgentEvalMemoryService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private trialQuery(
    db: MemoryDatabase,
    trial: Pick<EvalMemoryTrial, 'runId' | 'topicId'> & { testCaseId?: string },
  ) {
    const scope = { userId: this.userId, workspaceId: this.workspaceId };
    return db
      .select({ ownerId: topics.userId })
      .from(agentEvalRunTopics)
      .innerJoin(agentEvalRuns, eq(agentEvalRuns.id, agentEvalRunTopics.runId))
      .innerJoin(topics, eq(topics.id, agentEvalRunTopics.topicId))
      .where(
        and(
          eq(agentEvalRunTopics.runId, trial.runId),
          eq(agentEvalRunTopics.topicId, trial.topicId),
          trial.testCaseId ? eq(agentEvalRunTopics.testCaseId, trial.testCaseId) : undefined,
          buildWorkspaceWhere(scope, agentEvalRuns),
          buildWorkspaceWhere(scope, agentEvalRunTopics),
          buildWorkspaceWhere(scope, topics),
          eq(agentEvalRunTopics.userId, topics.userId),
          eq(topics.trigger, 'eval'),
        ),
      );
  }

  private async resolveOwner(
    db: MemoryDatabase,
    trial: Pick<EvalMemoryTrial, 'runId' | 'threadId' | 'topicId'> & { testCaseId?: string },
    lock = false,
  ) {
    const query = this.trialQuery(db, trial);
    const [row] = await (lock ? query.for('update', { of: agentEvalRunTopics }) : query);
    if (!row) throw new Error('Eval Memory trial not found or not owned by caller');
    if (trial.threadId) {
      const [thread] = await db
        .select({ id: threads.id })
        .from(threads)
        .where(
          and(
            eq(threads.id, trial.threadId),
            eq(threads.topicId, trial.topicId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
          ),
        );
      if (!thread) throw new Error('Eval Memory thread does not belong to this trial');
    }
    return row.ownerId;
  }

  private async initialization(
    db: MemoryDatabase,
    ownerId: string,
    trial: Pick<EvalMemoryTrial, 'runId' | 'threadId' | 'topicId'>,
  ) {
    const [topic] = await db
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, trial.topicId));
    const marker = topic?.metadata?.evalMemoryFixtures?.[getEvalAttemptId(trial)];
    const entries = await db
      .select({ fixtureHash: agentEvalMemories.fixtureHash })
      .from(agentEvalMemories)
      .where(attemptWhere(ownerId, trial, { includeRemoved: true }));
    return {
      fixtureHash: marker ?? entries.find((entry) => entry.fixtureHash)?.fixtureHash,
      hasEntries: entries.length > 0,
    };
  }

  /** Read-only eligibility check for the UI/API, before any workflow is scheduled. */
  async assertResumeFixture(params: EvalMemoryTrial & { fixture: EvalMemoryFixture }) {
    const fixture = evalMemoryFixtureSchema.parse(params.fixture);
    const ownerId = await this.resolveOwner(this.db, params);
    const state = await this.initialization(this.db, ownerId, params);
    assertFixture(state, fixtureDigest(fixture), true);
  }

  /** Seed once, including an empty fixture; resume must bring the recorded fixture. */
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
    const ownerId = await this.resolveOwner(this.db, params);
    const existing = await this.initialization(this.db, ownerId, params);
    assertFixture(existing, fixtureHash, !!params.resume);
    const drafts = fixtureDrafts(fixture);
    // Only a new fixture needs embeddings. Reuse the topic owner's configuration
    // when another workspace editor starts or resumes the attempt.
    const embeddings =
      !existing.fixtureHash && drafts.length > 0
        ? await embedOrSkip(
            createEvalMemoryEmbedder({
              db: this.db,
              source: 'evalMemory:seed',
              userId: ownerId,
              workspaceId: this.workspaceId,
            }),
          )(drafts.map(semanticText))
        : [];

    return this.db.transaction(async (tx) => {
      const lockedOwner = await this.resolveOwner(tx, params, true);
      if (lockedOwner !== ownerId) throw new Error('Eval Memory trial owner changed');
      const seeded = await this.initialization(tx, ownerId, params);
      assertFixture(seeded, fixtureHash, !!params.resume);
      if (!seeded.fixtureHash && drafts.length > 0) {
        const capturedAt = fixture.seededAt ? new Date(fixture.seededAt) : new Date();
        // Written in fixture order, a millisecond apart, as rows the Memory tool
        // writes one after another are: the search's recency order among seeded
        // entries is then the fixture's, not the page order of one bulk insert.
        const writtenAt = Date.now();
        await tx.insert(agentEvalMemories).values(
          drafts.map((draft, index) => ({
            ...draft,
            attemptId: getEvalAttemptId(reference),
            capturedAt,
            createdAt: new Date(writtenAt + index),
            updatedAt: new Date(writtenAt + index),
            embedding: embeddings[index] ?? null,
            fixtureHash,
            runId: params.runId,
            source: 'fixture' as const,
            threadId: params.threadId ?? null,
            topicId: params.topicId,
            userId: ownerId,
          })),
        );
      }
      // Separate initialization evidence from searchable entries. The SQL merge
      // preserves unrelated metadata and other pass@k attempts. The RunTopic lock
      // serializes initialization, and neither Resume nor result resets clear it.
      await tx
        .update(topics)
        .set({
          metadata: sql`jsonb_set(COALESCE(${topics.metadata}, '{}'::jsonb), '{evalMemoryFixtures}',
          COALESCE(${topics.metadata}->'evalMemoryFixtures', '{}'::jsonb) ||
          ${JSON.stringify({ [getEvalAttemptId(reference)]: fixtureHash })}::jsonb)`,
        })
        .where(eq(topics.id, params.topicId));
      return reference;
    });
  }

  /**
   * The reference must name the attempt the caller is executing: a pass@k
   * thread resolves from that thread and the sub-agent threads it spawned, a
   * topic-level attempt from its topic and any of its sub-agent threads.
   */
  private async assertContext(
    reference: EvalMemoryReference,
    context: { threadId?: string | null; topicId?: string | null },
  ) {
    if (!context.topicId || context.topicId !== reference.topicId)
      throw new Error('Eval Memory belongs to another trial');
    if (!reference.threadId || !context.threadId || reference.threadId === context.threadId) return;
    if (await this.isSubAgentThreadOf(context.threadId, reference.threadId, reference.topicId))
      return;
    throw new Error('Eval Memory belongs to another attempt of this trial');
  }

  /**
   * Whether `threadId` is a sub-agent's isolation thread spawned, directly or
   * through nested sub-agents, from the attempt thread. An isolation thread
   * hangs off the tool message that started it; that message lives in the
   * spawning thread. A sibling attempt's sub-agents never lead back here.
   */
  private async isSubAgentThreadOf(threadId: string, attemptThreadId: string, topicId: string) {
    const scope = { userId: this.userId, workspaceId: this.workspaceId };
    let current = threadId;
    for (let depth = 0; depth < MAX_SUB_AGENT_DEPTH; depth++) {
      const [row] = await this.db
        .select({
          parentThreadId: threads.parentThreadId,
          sourceThreadId: messages.threadId,
          type: threads.type,
        })
        .from(threads)
        .leftJoin(
          messages,
          and(eq(messages.id, threads.sourceMessageId), eq(messages.topicId, topicId)),
        )
        .where(
          and(
            eq(threads.id, current),
            eq(threads.topicId, topicId),
            buildWorkspaceWhere(scope, threads),
          ),
        )
        .limit(1);
      const parent = row?.parentThreadId ?? row?.sourceThreadId;
      if (!row || row.type !== ThreadType.Isolation || !parent) return false;
      if (parent === attemptThreadId) return true;
      current = parent;
    }
    return false;
  }

  /** The persona the attempt's prompt is built from (the fixture's, never the caller's). */
  async getPersonaDocument(
    reference: EvalMemoryReference,
    context: { threadId?: string | null; topicId?: string | null },
  ): Promise<{ persona: string; tagline?: string | null; version: number } | undefined> {
    await this.assertContext(reference, context);
    const ownerId = await this.resolveOwner(this.db, reference);
    const [row] = await this.db
      .select({ summary: agentEvalMemories.summary, title: agentEvalMemories.title })
      .from(agentEvalMemories)
      .where(and(attemptWhere(ownerId, reference), eq(agentEvalMemories.layer, 'persona')))
      .orderBy(asc(agentEvalMemories.createdAt))
      .limit(1);
    if (!row?.summary) return undefined;
    return { persona: row.summary, tagline: row.title, version: 0 };
  }

  /** The Memory tool of the attempt. */
  async runtime(options: {
    memoryEffort: 'high' | 'low' | 'medium';
    memoryEmbeddingRuntime?: ToolExecutionMemoryEmbeddingRuntime;
    reference: EvalMemoryReference;
    context: { threadId?: string | null; topicId?: string | null };
  }) {
    await this.assertContext(options.reference, options.context);
    const ownerId = await this.resolveOwner(this.db, options.reference);
    return new EvalMemoryRuntimeService({
      db: this.db,
      embed: embedOrSkip(
        createEvalMemoryEmbedder({
          db: this.db,
          memoryEmbeddingRuntime: options.memoryEmbeddingRuntime,
          source: 'evalMemory:tool',
          userId: ownerId,
          workspaceId: this.workspaceId,
        }),
      ),
      memoryEffort: options.memoryEffort,
      reference: options.reference,
      userId: ownerId,
    });
  }

  /** Everything the attempt's Memory holds, removed entries included, oldest first. */
  async snapshot(
    trial: Pick<EvalMemoryTrial, 'runId' | 'threadId' | 'topicId'>,
  ): Promise<EvalMemorySnapshot> {
    const ownerId = await this.resolveOwner(this.db, trial);
    const rows = await this.db
      .select()
      .from(agentEvalMemories)
      .where(attemptWhere(ownerId, trial, { includeRemoved: true }))
      .orderBy(asc(agentEvalMemories.capturedAt), asc(agentEvalMemories.createdAt));
    const initialized = await this.initialization(this.db, ownerId, trial);
    // Legacy empty fixtures have no hash. Preserve their actual entries without
    // claiming that the initial fixture was empty or dropping snapshot evidence.
    const fixtureHash = initialized.fixtureHash ?? null;
    // An entry that has searchable text but no vector was written without a
    // usable embedding model: the attempt ran on the simplified Memory search.
    const simplified = rows.some((row) => !row.embedding && !!semanticText(row));
    return {
      attemptId: getEvalAttemptId(trial),
      entries: rows.map(toEntry),
      fixtureHash,
      ...(simplified && { retrieval: 'simplified' as const }),
    };
  }
}

export { EvalMemoryRuntimeService } from './runtime';
