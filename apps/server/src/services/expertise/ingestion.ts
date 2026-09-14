import { randomUUID } from 'node:crypto';

import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  messages,
  topics,
} from '@lobechat/database/schemas';
import {
  chainExpertiseTopicIngestion,
  EXPERTISE_TOPIC_INGESTION_JSON_SCHEMA,
  EXPERTISE_TOPIC_INGESTION_PROMPT_VERSION,
} from '@lobechat/prompts';
import { and, asc, count, desc, eq, gt, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { ExpertiseModel } from '@/database/models/expertise';
import type { LobeChatDatabase } from '@/database/type';
import { notShareVisitorMessage, notShareVisitorTopic } from '@/database/utils/shareVisitor';
import type { CompletionCallbackParams } from '@/server/services/agentSignal/policies/completionPolicy';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { resolveExpertiseModelConfig } from './modelConfig';

const MAX_CONTEXT_MESSAGES = 24;
const MAX_CONTEXT_CHARS = 24_000;
const LESSON_CODE_PATTERN = /^P-\d+$/;
const AnalysisSchema = z.object({
  domains: z.array(
    z.object({
      domainId: z.string(),
      matches: z.boolean(),
      observations: z
        .array(
          z.object({
            example: z.string(),
            existingLessonCode: z.string().nullable(),
            layer: z.string().nullable(),
            outcome: z.enum(['pass', 'violation']),
            reasoning: z.string(),
            title: z.string(),
          }),
        )
        .max(8),
    }),
  ),
});

/**
 * The identity a lesson is deduplicated by.
 *
 * The title *is* the rule statement, so two lessons that normalize to the same string are the
 * same judgment written twice. Whitespace and case are dropped because the model rewrites both
 * freely between runs; punctuation is kept, since it is what separates a rule from its negation.
 */
export const normalizeLessonTitle = (title: string) => title.replaceAll(/\s+/g, '').toLowerCase();

/**
 * The lesson an observation attaches to, or `undefined` when it genuinely starts a new one.
 *
 * `existingLessonCode` is the model's own answer and is taken first, but only when it actually
 * looks like a code: the field name reads as "the existing code" to a model staring at a diff, and
 * roughly one observation in six comes back holding a source snippet instead. An unguarded lookup
 * turns every one of those into a fresh P-nn. The normalized title is the semantic fallback —
 * whatever the model meant to reference, an identical rule statement is that rule.
 */
const matchLesson = <T>(
  observation: { existingLessonCode: string | null; title: string },
  lessons: { byCode: Map<string, T>; byTitle: Map<string, T> },
) => {
  const code = observation.existingLessonCode?.trim();
  if (code && LESSON_CODE_PATTERN.test(code)) {
    const byCode = lessons.byCode.get(code);
    if (byCode) return byCode;
  }
  return lessons.byTitle.get(normalizeLessonTitle(observation.title));
};

interface ExpertiseCompletionInput {
  agentId: string;
  hadHumanInLoop?: boolean;
  ingestionKey?: string;
  operationId?: string;
  serializedContext?: string;
  topicId: string;
}

/**
 * Turns one completed topic turn into bounded expertise evidence.
 *
 * The completion event is the progress boundary: context is read up to the latest persisted
 * message, classified against every bound domain filter, then committed as one run per matching
 * domain. A non-matching conversation leaves no run behind.
 */
export class ExpertiseIngestionService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /**
   * Runs expertise ingestion only after the existing self-review window has completed.
   * Nightly review batches every active topic in its window; fast self-reflection reuses its
   * single topic scope. Other self-iteration modes are deliberately ignored.
   */
  ingestSelfReview = async (input: CompletionCallbackParams) => {
    const marker = input.selfIteration?.marker;
    const agentId = marker?.agentId;
    if (!marker || !agentId) return { ingested: 0, reason: 'missing-review-agent' } as const;

    if (marker.kind === 'self-reflection' && marker.topicId) {
      return this.ingestCompletion({
        agentId,
        operationId: input.operationId,
        topicId: marker.topicId,
      });
    }

    if (marker.kind !== 'nightly-review' || !marker.reviewWindowStart || !marker.reviewWindowEnd) {
      return { ingested: 0, reason: 'not-review' } as const;
    }

    const reviewContext = new AgentSignalReviewContextModel(this.db, this.userId, this.workspaceId);
    const topics = await reviewContext.listTopicActivity({
      agentId,
      limit: 100,
      windowEnd: new Date(marker.reviewWindowEnd),
      windowStart: new Date(marker.reviewWindowStart),
    });
    const results = [];
    for (const topic of topics) {
      if (!topic.topicId) continue;
      results.push(
        await this.ingestCompletion({
          agentId,
          operationId: input.operationId,
          topicId: topic.topicId,
        }),
      );
    }
    return {
      ingested: results.reduce((sum, result) => sum + result.ingested, 0),
      reason: 'nightly-review',
    } as const;
  };

  /**
   * The topics an agent has ever spoken in, resolved through indexes rather than a scan.
   *
   * A message belongs to the agent when `messages.agentId` says so, or — for rows written
   * before messages carried an agent — when the topic itself is the agent's. The naive
   * `COALESCE(messages.agentId, topics.agentId) = ?` form expresses the same thing but forces
   * Postgres to walk every message the user owns; both arms here start from an agent index.
   */
  private historicalTopicCandidates = (agentId: string) => {
    const scope = this.workspaceId
      ? eq(messages.workspaceId, this.workspaceId)
      : and(eq(messages.userId, this.userId), isNull(messages.workspaceId));

    // Share-visitor topics/messages are billed to the creator but are visitor traffic,
    // not the creator's own activity — they must never feed self-learning/expertise
    // ingestion. See `notShareVisitorMessage`/`notShareVisitorTopic` for the shared rule.
    const byMessageAgent = this.db
      .select({ topicId: messages.topicId })
      .from(messages)
      .where(
        and(
          scope,
          eq(messages.agentId, agentId),
          isNotNull(messages.topicId),
          notShareVisitorMessage(),
        ),
      );
    const byTopicAgent = this.db
      .select({ topicId: messages.topicId })
      .from(messages)
      .innerJoin(topics, eq(topics.id, messages.topicId))
      .where(
        and(scope, isNull(messages.agentId), eq(topics.agentId, agentId), notShareVisitorTopic()),
      );

    return byMessageAgent.union(byTopicAgent).as('historical_topic_candidates');
  };

  /** Lists existing conversations owned by this agent for an explicit historical backfill. */
  listHistoricalTopics = async (
    agentId: string,
    options: { cursor?: { lastActivityAt: Date; topicId: string }; limit?: number } = {},
  ) => {
    const candidates = this.historicalTopicCandidates(agentId);
    const scope = this.workspaceId
      ? eq(messages.workspaceId, this.workspaceId)
      : and(eq(messages.userId, this.userId), isNull(messages.workspaceId));

    const lastActivity = max(messages.createdAt);
    return this.db
      .select({
        lastActivityAt: max(messages.createdAt),
        topicId: sql<string>`${messages.topicId}`,
      })
      .from(messages)
      .innerJoin(candidates, eq(candidates.topicId, messages.topicId))
      .where(scope)
      .groupBy(messages.topicId)
      .having(
        options.cursor
          ? or(
              gt(lastActivity, options.cursor.lastActivityAt),
              and(
                eq(lastActivity, options.cursor.lastActivityAt),
                gt(messages.topicId, options.cursor.topicId),
              ),
            )
          : undefined,
      )
      .limit(options.limit ?? 50)
      .orderBy(asc(max(messages.createdAt)), asc(messages.topicId));
  };

  /** Counts historical topics so the UI can explain the scope before scheduling the backfill. */
  countHistoricalTopics = async (agentId: string) => {
    const candidates = this.historicalTopicCandidates(agentId);
    const [row] = await this.db.select({ count: count() }).from(candidates);

    return row?.count ?? 0;
  };

  /** Imports one old topic with a stable key, so retrying the workflow cannot duplicate runs. */
  ingestHistoricalTopic = async (agentId: string, topicId: string) =>
    this.ingestCompletion({
      agentId,
      ingestionKey: `historical-v1:${topicId}`,
      topicId,
    });

  /** Local-runtime fallback for the durable workflow used in queue deployments. */
  ingestHistory = async (agentId: string) => {
    let ingested = 0;
    let scanned = 0;
    let cursor: { lastActivityAt: Date; topicId: string } | undefined;
    while (true) {
      const topicRows = await this.listHistoricalTopics(agentId, { cursor, limit: 50 });
      for (const topic of topicRows) {
        const result = await this.ingestHistoricalTopic(agentId, topic.topicId);
        ingested += result.ingested;
        scanned += 1;
      }
      const last = topicRows.at(-1);
      if (!last || topicRows.length < 50 || !last.lastActivityAt) break;
      cursor = { lastActivityAt: last.lastActivityAt, topicId: last.topicId };
    }
    return { ingested, scanned };
  };

  ingestCompletion = async (input: ExpertiseCompletionInput) => {
    const expertiseModel = new ExpertiseModel(this.db, this.userId, this.workspaceId);
    const bound = await expertiseModel.listDomainsForAgent(input.agentId);
    if (bound.length === 0) return { ingested: 0, reason: 'no-domains' } as const;

    const topicContext = input.serializedContext
      ? {
          hadHumanInLoop: input.hadHumanInLoop ?? /^\[user\]/m.test(input.serializedContext),
          serializedContext: input.serializedContext,
        }
      : await this.readTopicContext(input.topicId);
    const context = topicContext.serializedContext.slice(-MAX_CONTEXT_CHARS);
    if (!context.trim()) return { ingested: 0, reason: 'empty-context' } as const;

    const modelConfig = await resolveExpertiseModelConfig(this.db, this.userId);

    const domains = await Promise.all(
      bound.map(async ({ domain }) => ({
        canon: domain.canonEntries,
        domainFilter: domain.domainFilter,
        id: domain.id,
        layers: domain.layers,
        lessons: (await expertiseModel.listLessons(domain.id)).map((lesson) => ({
          code: lesson.code,
          layer: lesson.layer,
          // The judgment behind the title. Without it the model is asked to decide "same judgment?"
          // from a headline alone, and reaches for a new lesson whenever the wording differs.
          why: lesson.sections.find((section) => section.key === 'why')?.body ?? null,
          title: lesson.title,
        })),
        outOfScope: domain.outOfScope,
        title: domain.title,
      })),
    );

    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const raw = await ai.generateObject(
      {
        ...chainExpertiseTopicIngestion({ context, domains }),
        ...modelConfig,
        schema: EXPERTISE_TOPIC_INGESTION_JSON_SCHEMA,
      },
      {
        metadata: { trigger: 'expertise_topic_ingestion' },
        tracing: {
          agentId: input.agentId,
          promptVersion: EXPERTISE_TOPIC_INGESTION_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.ExpertiseTopicIngestion,
          schemaName: EXPERTISE_TOPIC_INGESTION_JSON_SCHEMA.name,
          topicId: input.topicId,
        },
      },
    );
    const analysis = AnalysisSchema.parse(raw);
    let ingested = 0;

    for (const result of analysis.domains) {
      const domain = domains.find((item) => item.id === result.domainId);
      if (!domain || !result.matches) continue;
      await this.persistDomainRun({
        ...input,
        domain,
        hadHumanInLoop: topicContext.hadHumanInLoop,
        observations: result.observations,
      });
      ingested += 1;
    }

    return { ingested, reason: ingested > 0 ? 'matched' : 'no-match' } as const;
  };

  private readTopicContext = async (topicId: string) => {
    const rows = await this.db.query.messages.findMany({
      columns: { content: true, createdAt: true, role: true },
      limit: MAX_CONTEXT_MESSAGES,
      orderBy: [desc(messages.createdAt)],
      where: and(
        this.workspaceId
          ? eq(messages.workspaceId, this.workspaceId)
          : and(eq(messages.userId, this.userId), isNull(messages.workspaceId)),
        eq(messages.topicId, topicId),
        isNull(messages.threadId),
        // Same rule as `historicalTopicCandidates` above — exclude share-visitor messages.
        notShareVisitorMessage(),
      ),
    });
    return {
      hadHumanInLoop: rows.some((row) => row.role === 'user'),
      serializedContext: rows
        .reverse()
        .map((row) => `[${row.role}] ${row.content ?? ''}`)
        .join('\n\n'),
    };
  };

  private persistDomainRun = async (
    input: ExpertiseCompletionInput & {
      domain: { id: string };
      observations: z.infer<typeof AnalysisSchema>['domains'][number]['observations'];
    },
  ) => {
    const reflectionKey = input.ingestionKey
      ? `topic:${input.topicId}:${input.ingestionKey}`
      : `topic:${input.topicId}:operation:${input.operationId}`;
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: expertiseDomains.id })
        .from(expertiseDomains)
        .where(eq(expertiseDomains.id, input.domain.id))
        .for('update');
      const [existingRun] = await tx
        .select({ id: expertiseRuns.id })
        .from(expertiseRuns)
        .where(
          and(
            eq(expertiseRuns.domainId, input.domain.id),
            eq(expertiseRuns.reflectionKey, reflectionKey),
          ),
        )
        .limit(1);
      if (existingRun) return;

      const [prior] = await tx
        .select({ value: max(expertiseRuns.runIndex) })
        .from(expertiseRuns)
        .where(eq(expertiseRuns.domainId, input.domain.id));
      const runIndex = (prior?.value ?? 0) + 1;
      const runId = randomUUID();
      let newCount = 0;
      let instanceCount = 0;

      await tx.insert(expertiseRuns).values({
        actorId: input.agentId,
        actorType: 'agent',
        completedAt: new Date(),
        domainId: input.domain.id,
        hadHumanInLoop: input.hadHumanInLoop ?? false,
        id: runId,
        reflectionKey,
        runIndex,
        subjectId: input.topicId,
        subjectType: 'topic',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });

      const persisted = await tx
        .select({
          code: expertiseLessons.code,
          id: expertiseLessons.id,
          status: expertiseLessons.status,
          title: expertiseLessons.title,
        })
        .from(expertiseLessons)
        .where(eq(expertiseLessons.domainId, input.domain.id))
        .orderBy(asc(expertiseLessons.createdAt), asc(expertiseLessons.code));
      // A retired code is never handed out again, so the counter walks every row; only active
      // lessons are dedup targets, because attaching to one the user chose to forget revives it.
      let nextCodeNumber =
        Math.max(0, ...persisted.map(({ code }) => Number(/^P-(\d+)$/.exec(code)?.[1] ?? 0))) + 1;
      const byCode = new Map<string, string>();
      const byTitle = new Map<string, string>();
      for (const lesson of persisted) {
        if (lesson.status !== 'active') continue;
        byCode.set(lesson.code, lesson.id);
        // Oldest wins, so a domain that already holds duplicates converges on one canonical row.
        const key = normalizeLessonTitle(lesson.title);
        if (!byTitle.has(key)) byTitle.set(key, lesson.id);
      }
      const countedLessonIds = new Set<string>();

      for (const observation of input.observations) {
        const matchedId = matchLesson(observation, { byCode, byTitle });
        if (!matchedId) {
          newCount += 1;
          const lessonId = randomUUID();
          const code = `P-${String(nextCodeNumber++).padStart(2, '0')}`;
          // Distilled from practice, not taught: leave `createdByUserId` empty so the portrait
          // does not list every learned habit under "you taught it".
          await tx.insert(expertiseLessons).values({
            code,
            domainId: input.domain.id,
            id: lessonId,
            exampleCount: 1,
            hitCount: 1,
            hitRunCount: 1,
            layer: observation.layer,
            lastHitAt: new Date(),
            lastHitRunId: runId,
            originRunId: runId,
            polarity: 'rule',
            sections: [
              { body: observation.title, key: 'rule' },
              { body: observation.reasoning, key: 'why' },
              { body: observation.example, key: 'how' },
            ],
            title: observation.title,
          });
          byCode.set(code, lessonId);
          byTitle.set(normalizeLessonTitle(observation.title), lessonId);
          countedLessonIds.add(lessonId);
          await tx.insert(expertiseHits).values({
            domainId: input.domain.id,
            example: observation.example,
            lessonId,
            note: observation.reasoning,
            operationId: input.operationId,
            outcome: observation.outcome,
            runId,
          });
        } else {
          instanceCount += 1;
          await tx.insert(expertiseHits).values({
            domainId: input.domain.id,
            example: observation.example,
            lessonId: matchedId,
            note: observation.reasoning,
            operationId: input.operationId,
            outcome: observation.outcome,
            runId,
          });
          const firstHitThisRun = !countedLessonIds.has(matchedId);
          countedLessonIds.add(matchedId);
          await tx
            .update(expertiseLessons)
            .set({
              exampleCount: sql`${expertiseLessons.exampleCount} + 1`,
              hitCount: sql`${expertiseLessons.hitCount} + 1`,
              hitRunCount: firstHitThisRun
                ? sql`${expertiseLessons.hitRunCount} + 1`
                : expertiseLessons.hitRunCount,
              lastHitAt: new Date(),
              lastHitRunId: runId,
            })
            .where(eq(expertiseLessons.id, matchedId));
        }
      }

      await tx
        .update(expertiseRuns)
        .set({ instanceCount, newCount })
        .where(eq(expertiseRuns.id, runId));

      const [counts] = await tx
        .select({
          active: sql<number>`count(*) filter (where ${expertiseLessons.status} = 'active')::int`,
          compiled: sql<number>`count(*) filter (where ${expertiseLessons.compiledCriterionId} is not null)::int`,
          retired: sql<number>`count(*) filter (where ${expertiseLessons.status} = 'retired')::int`,
        })
        .from(expertiseLessons)
        .where(eq(expertiseLessons.domainId, input.domain.id));
      const layerRows = await tx
        .select({ layer: expertiseLessons.layer, value: sql<number>`count(*)::int` })
        .from(expertiseLessons)
        .where(
          and(
            eq(expertiseLessons.domainId, input.domain.id),
            eq(expertiseLessons.status, 'active'),
          ),
        )
        .groupBy(expertiseLessons.layer)
        .orderBy(asc(expertiseLessons.layer));

      await tx.insert(expertiseDomainSnapshots).values({
        activeCount: counts?.active ?? 0,
        compiledCount: counts?.compiled ?? 0,
        domainId: input.domain.id,
        layerCounts: Object.fromEntries(
          layerRows.filter((row) => row.layer).map((row) => [row.layer!, row.value]),
        ),
        learnedTotal: (counts?.active ?? 0) + (counts?.retired ?? 0),
        retiredTotal: counts?.retired ?? 0,
        runId,
        runIndex,
      });
    });
  };
}
