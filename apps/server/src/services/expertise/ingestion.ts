import { randomUUID } from 'node:crypto';

import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  acceptances,
  expertiseDomains,
  expertiseDomainSnapshots,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  messages,
  projects,
  topics,
  verifyCheckResults,
} from '@lobechat/database/schemas';
import {
  chainExpertiseRejectionIngestion,
  chainExpertiseTopicIngestion,
  EXPERTISE_REJECTION_INGESTION_JSON_SCHEMA,
  EXPERTISE_REJECTION_INGESTION_PROMPT_VERSION,
  EXPERTISE_TOPIC_INGESTION_JSON_SCHEMA,
  EXPERTISE_TOPIC_INGESTION_PROMPT_VERSION,
} from '@lobechat/prompts';
import type { VerifyCheckDecisionDetail } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { and, asc, count, desc, eq, gt, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { ExpertiseModel } from '@/database/models/expertise';
import { FileModel } from '@/database/models/file';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import type { LobeChatDatabase } from '@/database/type';
import { notShareVisitorMessage, notShareVisitorTopic } from '@/database/utils/shareVisitor';
import type { CompletionCallbackParams } from '@/server/services/agentSignal/policies/completionPolicy';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { FileService } from '@/server/services/file';
import { resolveModelReadableFrameUrl } from '@/server/services/verify/modelFrames';

import type { ConsolidationResult } from './consolidation';
import { ExpertiseConsolidationService } from './consolidation';
import { resolveExpertiseModelConfig } from './modelConfig';
import { isProviderAccountError } from './providerAccountError';

const log = debug('lobe-server:expertise-ingestion');

const MAX_CONTEXT_MESSAGES = 24;
const MAX_CONTEXT_CHARS = 24_000;
/**
 * Frames attached to one round's distillation. A round is a batch, unlike the single-check review
 * that caps at 3 — but every frame is a full base64 body, so the cap is what keeps a 20-rejection
 * round from becoming a request no provider will accept.
 */
const MAX_REJECTION_FRAMES = 8;
const VISUAL_REJECTION_EVIDENCE_TYPES = new Set(['screenshot', 'gif']);

/** Normalized 0-1 region coordinates read better to a model as percentages. */
const pct = (value: number) => `${Math.round(value * 100)}%`;

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
 * Same shape as {@link AnalysisSchema}, minus `outcome` (a rejection is always a violation) and
 * plus the rejections each observation was distilled from.
 */
const RejectionAnalysisSchema = z.object({
  domains: z.array(
    z.object({
      domainId: z.string(),
      matches: z.boolean(),
      observations: z
        .array(
          z.object({
            example: z.string(),
            // Empty string, not null: see the chain's schema comment — a nullable union comes
            // back from the pinned model as `{}` and takes the whole round down with it.
            existingLessonCode: z.string(),
            layer: z.string(),
            limits: z.string(),
            reasonKind: z.enum(['mechanism', 'taste']),
            reasoning: z.string(),
            reasonSource: z.enum(['reviewer', 'inferred']),
            sourceRefs: z.array(z.string()),
            subject: z.string(),
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
 * One practice run, as the caller defines it. A topic completion and an acceptance round are both
 * "a complete judgement of one object", so they share the whole write path below and differ only
 * in these fields — notably `reflectionKey`, which is what makes a replayed ingestion a no-op.
 */
interface ExpertiseRunDescriptor {
  actorId: string;
  actorType: 'agent' | 'system' | 'user';
  hadHumanInLoop: boolean;
  operationId?: string;
  reflectionKey: string;
  subjectId: string;
  subjectType: 'document' | 'standalone' | 'task' | 'topic';
}

/** An observation ready to persist, after whichever analysis produced it. */
interface PersistableObservation {
  example: string;
  existingLessonCode: string | null;
  layer: string | null;
  /** When the lesson does not apply — kept out of the prompt-facing sections when absent. */
  limits?: string | null;
  outcome: 'pass' | 'violation';
  reasoning: string;
  /**
   * Whether the standard rests on something observable or on the owner's preference. A taste
   * standard is legitimate — a reviewer is allowed to just want things a certain way — but it has
   * no objective test, so the compile step must not turn it into a criterion that blocks a
   * delivery on its own.
   */
  reasonKind?: 'mechanism' | 'taste';
  /**
   * Whether the reviewer gave the reason or the distillation supplied the mechanism. An inferred
   * reason is still worth keeping — it is what lets a standard transfer to a screen nobody has
   * built yet — but it must never read as something the reviewer said, because the compile step
   * downstream turns a lesson's reason into an enforced criterion.
   */
  reasonSource?: 'inferred' | 'reviewer';
  /**
   * The rejections this observation was distilled from. One standard can be violated several
   * times in a single round, and each violation is its own hit — that is what makes "sourced from
   * N rejections" a real count rather than a count of analysis passes.
   */
  sourceCheckResultIds?: string[];
  /** What the standard is really about, once the concrete names are replaced by what they exemplify. */
  subject?: null | string;
  title: string;
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

  /**
   * Imports one old topic with a stable key, so retrying the workflow cannot duplicate runs.
   *
   * A provider account refusal is the user's to fix, not a server fault: it finishes as a skip so
   * the durable workflow neither reports a 500 nor retries every topic against a dead account.
   */
  ingestHistoricalTopic = async (agentId: string, topicId: string) => {
    try {
      return await this.ingestCompletion({
        agentId,
        ingestionKey: `historical-v1:${topicId}`,
        topicId,
      });
    } catch (error) {
      if (isProviderAccountError(error)) {
        return { ingested: 0, reason: 'provider-account-error' } as const;
      }
      throw error;
    }
  };

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
        // Every remaining topic would hit the same refusal until the user fixes their account.
        if (result.reason === 'provider-account-error') return { ingested, scanned };
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
        metadata: { trigger: RequestTrigger.Expertise },
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
        domain,
        observations: result.observations,
        run: {
          actorId: input.agentId,
          actorType: 'agent',
          hadHumanInLoop: topicContext.hadHumanInLoop,
          operationId: input.operationId,
          reflectionKey: input.ingestionKey
            ? `topic:${input.topicId}:${input.ingestionKey}`
            : `topic:${input.topicId}:operation:${input.operationId}`,
          subjectId: input.topicId,
          subjectType: 'topic',
        },
      });
      ingested += 1;
    }

    return { ingested, reason: ingested > 0 ? 'matched' : 'no-match' } as const;
  };

  /**
   * Distils one settled acceptance round's rejections into delivery standards.
   *
   * Called when the NEXT round lands (or the acceptance completes), because that is the first
   * moment the reviewer's judgement on this round is certainly final: the product's own reject
   * flow ends at a clipboard copy, so no server-side event marks "I finished reviewing".
   */
  ingestAcceptanceRound = async (input: { acceptanceId: string; verifyRunId: string }) => {
    const [acceptance] = await this.db
      .select({
        id: acceptances.id,
        projectId: acceptances.projectId,
        subjectId: acceptances.subjectId,
        subjectType: acceptances.subjectType,
      })
      .from(acceptances)
      .where(and(eq(acceptances.id, input.acceptanceId), eq(acceptances.userId, this.userId)))
      .limit(1);
    if (!acceptance) return { ingested: 0, reason: 'no-acceptance' } as const;

    const rejections = await this.db
      .select({
        detail: verifyCheckResults.userDecisionDetail,
        id: verifyCheckResults.id,
        title: verifyCheckResults.checkItemTitle,
      })
      .from(verifyCheckResults)
      .where(
        and(
          eq(verifyCheckResults.verifyRunId, input.verifyRunId),
          eq(verifyCheckResults.userDecision, 'rejected'),
        ),
      )
      .orderBy(asc(verifyCheckResults.checkItemIndex), asc(verifyCheckResults.createdAt));
    if (rejections.length === 0) return { ingested: 0, reason: 'no-rejections' } as const;

    const labelled = rejections.map((rejection, index) => ({
      ...rejection,
      ref: `R${index + 1}`,
    }));
    const byRef = new Map(labelled.map((rejection) => [rejection.ref, rejection.id]));
    const { visuals, withheld } = await this.resolveRejectionFrames(labelled);
    const frameLabelByEvidence = new Map(
      visuals.map((visual, index) => [visual.evidenceId, `frame ${index + 1}`]),
    );
    const rendered = labelled
      .map((rejection) => {
        const regions = (rejection.detail?.annotations ?? []).map((annotation) => {
          const frame = frameLabelByEvidence.get(annotation.evidenceId);
          // Regions are normalized 0-1; percentages read better to a model than raw floats.
          const at = annotation.rect
            ? ` at ${pct(annotation.rect.x)},${pct(annotation.rect.y)} sized ${pct(annotation.rect.width)}×${pct(annotation.rect.height)}`
            : '';
          return `  circled${frame ? ` on ${frame}` : ''}${at}: ${annotation.comment?.trim() || '(no note)'}`;
        });
        return [
          `[${rejection.ref}] promised: ${rejection.title ?? '(untitled check)'}`,
          rejection.detail?.comment?.trim() && `  said: ${rejection.detail.comment.trim()}`,
          ...regions,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n')
      .slice(0, MAX_CONTEXT_CHARS);

    const expertiseModel = new ExpertiseModel(this.db, this.userId, this.workspaceId);
    const listDomains = () =>
      acceptance.projectId
        ? expertiseModel.listDomainsForProject(acceptance.projectId)
        : expertiseModel.listDomainsForOwner();

    let bound = await listDomains();
    if (bound.length === 0) {
      await this.createDeliveryStandardsDomain(acceptance.projectId);
      bound = await listDomains();
      if (bound.length === 0) return { ingested: 0, reason: 'no-domains' } as const;
    }

    const modelConfig = await resolveExpertiseModelConfig(this.db, this.userId);
    const domains = await Promise.all(
      bound.map(async ({ domain }) => ({
        domainFilter: domain.domainFilter,
        id: domain.id,
        layers: domain.layers,
        lessons: (await expertiseModel.listLessons(domain.id)).map((lesson) => ({
          code: lesson.code,
          layer: lesson.layer,
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
        ...chainExpertiseRejectionIngestion({
          domains,
          rejections: rendered,
          visuals,
          withheldEvidence: withheld,
        }),
        ...modelConfig,
        schema: EXPERTISE_REJECTION_INGESTION_JSON_SCHEMA,
      },
      {
        metadata: { trigger: RequestTrigger.Expertise },
        tracing: {
          promptVersion: EXPERTISE_REJECTION_INGESTION_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.ExpertiseRejectionIngestion,
          schemaName: EXPERTISE_REJECTION_INGESTION_JSON_SCHEMA.name,
        },
      },
    );
    const analysis = RejectionAnalysisSchema.parse(raw);

    let ingested = 0;
    const consolidated: ConsolidationResult[] = [];
    for (const result of analysis.domains) {
      const domain = domains.find((item) => item.id === result.domainId);
      if (!domain || !result.matches || result.observations.length === 0) continue;
      const touched = await this.persistDomainRun({
        domain,
        observations: result.observations.map((observation) => ({
          ...observation,
          existingLessonCode: observation.existingLessonCode.trim() || null,
          layer: observation.layer.trim() || null,
          // A rejection is a violation by construction — never let the model relabel it a pass.
          outcome: 'violation' as const,
          // Hallucinated refs are dropped rather than failing the round: losing one provenance
          // link is cheaper than losing the whole distillation.
          sourceCheckResultIds: observation.sourceRefs
            .map((ref) => byRef.get(ref))
            .filter((id): id is string => Boolean(id)),
        })),
        run: {
          actorId: this.userId,
          actorType: 'user',
          hadHumanInLoop: true,
          reflectionKey: `acceptance:${acceptance.id}:run:${input.verifyRunId}`,
          subjectId: acceptance.subjectId,
          subjectType: acceptance.subjectType,
        },
      });
      ingested += 1;
      consolidated.push(...(await this.consolidateTouched(domain.id, touched)));
    }

    return {
      consolidated,
      ingested,
      reason: ingested > 0 ? 'matched' : 'no-match',
    } as const;
  };

  /**
   * Restates the standards this round pushed past the instance threshold.
   *
   * Deliberately after the write, not inside it: consolidation reads frames and calls a model, and
   * a round of rejections that is safely recorded must not be rolled back because the rewrite of
   * an unrelated standard failed. For the same reason a failure here is logged, not thrown — the
   * standard keeps the wording it already had, which is exactly the state before this pass existed.
   */
  private consolidateTouched = async (domainId: string, lessonIds: string[]) => {
    if (lessonIds.length === 0) return [];
    const service = new ExpertiseConsolidationService(this.db, this.userId, this.workspaceId);
    const due = await service.dueForConsolidation(domainId, lessonIds);

    return (
      await pMap(
        due,
        async (lessonId) => {
          try {
            return await service.consolidate(lessonId);
          } catch (error) {
            log('consolidation failed for lesson %s: %O', lessonId, error);
            return null;
          }
        },
        { concurrency: 2 },
      )
    ).filter((result): result is ConsolidationResult => Boolean(result));
  };

  /**
   * The frames behind one round's rejections, circled ones first.
   *
   * Most of these rejections are visual — 616 of this owner's 876 carry a circled region — so a
   * text-only request asks the model to distil "this isn't aligned" without ever seeing what was
   * not aligned. Frames are inlined as data URIs rather than linked, because a link makes the
   * provider fetch from our storage and a local or private bucket is simply unreachable.
   *
   * Priority is deliberate rather than first-come: a budget spent in insertion order drops exactly
   * the circled frames the reviewer pointed at. Whatever does not fit is named in the prompt, so
   * the model never reads a withheld frame as evidence of absence.
   */
  private resolveRejectionFrames = async (
    rejections: { detail: VerifyCheckDecisionDetail | null; id: string; ref: string }[],
  ) => {
    const fileModel = new FileModel(this.db, this.userId, this.workspaceId);
    const fileService = new FileService(this.db, this.userId, this.workspaceId);
    const evidenceModel = new VerifyEvidenceModel(this.db, this.userId, this.workspaceId);

    const candidates: { circled: boolean; evidenceId: string; fileId: string; label: string }[] =
      [];
    for (const rejection of rejections) {
      const circled = new Set(
        (rejection.detail?.annotations ?? []).map((annotation) => annotation.evidenceId),
      );
      const rows = await evidenceModel.listByCheckResult(rejection.id);
      for (const row of rows) {
        if (!VISUAL_REJECTION_EVIDENCE_TYPES.has(row.type) || !row.fileId) continue;
        const isCircled = circled.has(row.id);
        candidates.push({
          circled: isCircled,
          evidenceId: row.id,
          fileId: row.fileId,
          label: `${rejection.ref}${isCircled ? ' (circled)' : ''} — ${row.description || 'evidence'}`,
        });
      }
    }

    const ordered = [
      ...candidates.filter((candidate) => candidate.circled),
      ...candidates.filter((candidate) => !candidate.circled),
    ];
    const selected = ordered.slice(0, MAX_REJECTION_FRAMES);

    const resolved = await pMap(
      selected,
      async (item) => {
        const file = await fileModel.findById(item.fileId);
        if (!file) return null;
        return {
          accessUrl: await resolveModelReadableFrameUrl(fileService, file),
          evidenceId: item.evidenceId,
          label: item.label,
        };
      },
      { concurrency: 4 },
    );

    const visuals = resolved.filter((item): item is NonNullable<typeof item> => Boolean(item));
    const dropped = ordered.length - selected.length;
    return {
      visuals,
      withheld:
        dropped > 0
          ? `${dropped} further screenshot(s) from this round were not attached. Absence of a frame is not evidence that nothing was wrong there.`
          : undefined,
    };
  };

  /**
   * The domain a project's rejections land in before anyone has authored one.
   *
   * Owned by the user (never by the project — a project mounts standards, it does not own them),
   * so the same domain can later be mounted by a sibling project without being copied.
   */
  private createDeliveryStandardsDomain = async (projectId: null | string) => {
    const [project] = projectId
      ? await this.db
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1)
      : [];
    const scope = project?.name ?? 'my work';

    return new ExpertiseModel(this.db, this.userId, this.workspaceId).createDomain({
      brief: `Delivery standards distilled from rejected acceptance checks on ${scope}.`,
      carrier: projectId ? { id: projectId, type: 'project' } : { type: 'user' },
      domainFilter: `Strip the screen names, component names and this task's name out of the requirement — does it still hold for any delivery on ${scope}? Only then is it mine.`,
      outOfScope:
        'One-off facts about a single screen, and anything that stops being true once the task changes.',
      title: `${scope} delivery standards`,
    });
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

  private persistDomainRun = async (input: {
    domain: { id: string };
    observations: PersistableObservation[];
    run: ExpertiseRunDescriptor;
  }): Promise<string[]> => {
    const { reflectionKey } = input.run;
    return this.db.transaction(async (tx) => {
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
      if (existingRun) return [];

      const [prior] = await tx
        .select({ value: max(expertiseRuns.runIndex) })
        .from(expertiseRuns)
        .where(eq(expertiseRuns.domainId, input.domain.id));
      const runIndex = (prior?.value ?? 0) + 1;
      const runId = randomUUID();
      let newCount = 0;
      let instanceCount = 0;

      await tx.insert(expertiseRuns).values({
        actorId: input.run.actorId,
        actorType: input.run.actorType,
        completedAt: new Date(),
        domainId: input.domain.id,
        hadHumanInLoop: input.run.hadHumanInLoop,
        id: runId,
        reflectionKey,
        runIndex,
        subjectId: input.run.subjectId,
        subjectType: input.run.subjectType,
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
      const touchedLessonIds = new Set<string>();

      // One observation yields one hit per rejection it cites, so hitCount stays a count of real
      // violations; an observation with no cited source (the topic path) still yields one.
      //
      // Deduplicated here rather than at the caller: `hitCount` is what ranks the standards list
      // and decides core-versus-niche, so one rejection counted twice because the model repeated
      // its label ("R1", "R1") is a durable distortion, and this is the only place hits are made.
      const writeHits = async (lessonId: string, observation: PersistableObservation) => {
        const cited = [...new Set(observation.sourceCheckResultIds ?? [])];
        const sources = cited.length > 0 ? cited : [undefined];
        await tx.insert(expertiseHits).values(
          sources.map((sourceCheckResultId) => ({
            domainId: input.domain.id,
            example: observation.example,
            lessonId,
            note: observation.reasoning,
            operationId: input.run.operationId,
            outcome: observation.outcome,
            runId,
            sourceCheckResultId,
          })),
        );
        return sources.length;
      };

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
            hitCount: new Set(observation.sourceCheckResultIds ?? []).size || 1,
            hitRunCount: 1,
            layer: observation.layer,
            lastHitAt: new Date(),
            lastHitRunId: runId,
            originRunId: runId,
            polarity: 'rule',
            // Columns, not a sentence appended to the body: the compile step has to be able to
            // refuse a taste standard, and the body is written in the reviewer's own language.
            reasonKind: observation.reasonKind,
            reasonSource: observation.reasonSource,
            sections: [
              {
                body: observation.subject?.trim()
                  ? `${observation.title}\n\n适用对象：${observation.subject.trim()}`
                  : observation.title,
                key: 'rule' as const,
              },
              { body: observation.reasoning, key: 'why' as const },
              { body: observation.example, key: 'how' as const },
              ...(observation.limits?.trim()
                ? [{ body: observation.limits.trim(), key: 'limits' as const }]
                : []),
            ],
            title: observation.title,
          });
          byCode.set(code, lessonId);
          byTitle.set(normalizeLessonTitle(observation.title), lessonId);
          countedLessonIds.add(lessonId);
          touchedLessonIds.add(lessonId);
          await writeHits(lessonId, observation);
        } else {
          instanceCount += 1;
          const hits = await writeHits(matchedId, observation);
          const firstHitThisRun = !countedLessonIds.has(matchedId);
          countedLessonIds.add(matchedId);
          touchedLessonIds.add(matchedId);
          await tx
            .update(expertiseLessons)
            .set({
              exampleCount: sql`${expertiseLessons.exampleCount} + 1`,
              hitCount: sql`${expertiseLessons.hitCount} + ${hits}`,
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

      return [...touchedLessonIds];
    });
  };
}
