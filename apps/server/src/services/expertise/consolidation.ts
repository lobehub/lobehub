import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  expertiseHits,
  expertiseLessonRevisions,
  expertiseLessons,
  verifyCheckResults,
  verifyRuns,
} from '@lobechat/database/schemas';
import {
  chainExpertiseConsolidation,
  EXPERTISE_CONSOLIDATION_JSON_SCHEMA,
  EXPERTISE_CONSOLIDATION_PROMPT_VERSION,
} from '@lobechat/prompts';
import type {
  ExpertiseLessonSection,
  ExpertiseRevisionEvidence,
  VerifyCheckDecisionDetail,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { and, desc, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { FileModel } from '@/database/models/file';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { FileService } from '@/server/services/file';
import { resolveModelReadableFrameUrl } from '@/server/services/verify/modelFrames';

import { resolveExpertiseModelConfig } from './modelConfig';

const log = debug('lobe-server:expertise-consolidation');

/**
 * Instances a standard needs before it is worth restating.
 *
 * Two is a coincidence — the second rejection can attach to the first on wording alone. Measured
 * on this owner's 898 circled rejections, grouping by the standard behind them puts 40% of the
 * "unrequested decoration" complaints and 62% of the spacing ones into groups of 2+ (largest: 12),
 * while placement complaints reach only 11%. So the material exists, and most of it arrives in
 * threes and up.
 */
const MIN_INSTANCES = 3;

/** Instances read per pass. Beyond this the frames, not the reasoning, are what caps the request. */
const MAX_INSTANCES = 8;

/**
 * Accepted deliveries offered as the contrast set.
 *
 * This is the only input that can justify a `limits`, so it is not optional padding: without it
 * the pass can restate a standard but can never bound one. Measured on 23 accepted deliveries,
 * standards distilled this way fired on 39% of them — every one of those is a boundary the
 * reviewer drew and nobody wrote down.
 */
const MAX_SHIPPED = 6;

/** Total frames inlined. Each is a full base64 body, so this is a payload budget. */
const MAX_FRAMES = 10;

const pct = (value: number) => `${Math.round(value * 100)}%`;

const ConsolidationSchema = z.object({
  currentLimitsArePlaceholder: z.boolean(),
  generalized: z.boolean(),
  limits: z.array(z.object({ shippedRefs: z.array(z.string()), text: z.string() })),
  note: z.string(),
  reasonKind: z.enum(['mechanism', 'taste']),
  reasoning: z.string(),
  subject: z.string(),
  title: z.string(),
});

/** Whitespace-insensitive, so the same limit written twice is not kept twice. */
const squash = (text: string) => text.replaceAll(/\s+/g, '');

/**
 * The limits a consolidated standard ends up with, and what each new one rests on.
 *
 * Existing limits are kept verbatim and are never re-derived from the model's answer: they were
 * drawn by the reviewer, and a pass that forgot to echo one back would silently widen a standard
 * they had bounded. The single exception is ingestion's "no boundary stated" placeholder, which is
 * dropped only when a real exemption arrives to replace it — and only the model can tell the two
 * apart, since the placeholder is written in whatever language the reviewer used.
 *
 * A new exemption survives only if it names a shipped delivery that was actually offered. No refs,
 * an instance's ref, a label that was never listed — all dropped. This is where "never invent a
 * boundary" stops being a request to the model.
 */
export const resolveLimits = (
  limits: z.infer<typeof ConsolidationSchema>['limits'],
  shippedIds: string[],
  current: { isPlaceholder: boolean; text: string },
) => {
  const byRef = new Map(shippedIds.map((id, index) => [`S${index + 1}`, id]));
  const boundaries: ExpertiseRevisionEvidence['boundaries'] = [];

  for (const limit of limits) {
    const text = limit.text.trim();
    if (!text) continue;
    const checkResultIds = [
      ...new Set(
        limit.shippedRefs
          .map((ref) => byRef.get(ref.trim()))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (checkResultIds.length === 0) continue;
    boundaries.push({ checkResultIds, limit: text });
  }

  const existing = current.text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  // The placeholder only goes away once something real replaces it; with no additions the standard
  // keeps exactly the limits section it had.
  const kept = current.isPlaceholder && boundaries.length > 0 ? [] : existing;
  const seen = new Set(kept.map((line) => squash(line)));
  const added = boundaries
    .map((boundary) => boundary.limit)
    .filter((text) => !seen.has(squash(text)) && seen.add(squash(text)));

  return { boundaries, texts: [...kept, ...added] };
};

export interface ConsolidationResult {
  generalized: boolean;
  lessonId: string;
  note: string;
  reason?: 'below-threshold' | 'no-instances' | 'no-lesson' | 'nothing-new';
  title?: string;
}

/**
 * Restates a standard at the level its instances share, once it has several.
 *
 * Ingestion writes a lesson from the first rejection that produced it and, on every rejection
 * after that, only bumps its counters — so a standard that has fired eight times is still worded
 * for the screen it was born on, and still carries no boundary. Both gaps are measurable: of 44
 * rejections in the same category as a distilled standard but from other acceptances, the standard
 * reproduced the reviewer's actual objection on 4, while firing on 39% of deliveries they had
 * accepted. A rule written from one case and bounded by nothing does both of those.
 *
 * This pass is the missing half. It reads every instance at once (so the wording can climb to what
 * they share instead of what one of them said) together with deliveries the reviewer accepted (so
 * a limit can be read off a case they let through, rather than invented).
 */
export class ExpertiseConsolidationService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /**
   * Standards in this domain that have taken on instances since they were last restated.
   *
   * The "since" is read off the revision log rather than a counter column: a lesson consolidated
   * at three instances and sitting at three has nothing to learn, while the same lesson at four
   * does. Comparing timestamps keeps that true without a column that can drift out of step.
   */
  dueForConsolidation = async (domainId: string, lessonIds?: string[]): Promise<string[]> => {
    const lastGeneralized = this.db
      .select({
        at: sql<Date>`max(${expertiseLessonRevisions.createdAt})`.as('at'),
        lessonId: expertiseLessonRevisions.lessonId,
      })
      .from(expertiseLessonRevisions)
      .where(eq(expertiseLessonRevisions.kind, 'generalize'))
      .groupBy(expertiseLessonRevisions.lessonId)
      .as('last_generalized');

    const rows = await this.db
      .select({
        id: expertiseLessons.id,
        pending: sql<number>`count(${expertiseHits.id}) filter (
          where ${lastGeneralized.at} is null or ${expertiseHits.createdAt} > ${lastGeneralized.at}
        )::int`,
        total: sql<number>`count(${expertiseHits.id})::int`,
      })
      .from(expertiseLessons)
      .leftJoin(expertiseHits, eq(expertiseHits.lessonId, expertiseLessons.id))
      .leftJoin(lastGeneralized, eq(lastGeneralized.lessonId, expertiseLessons.id))
      .where(
        and(
          eq(expertiseLessons.domainId, domainId),
          eq(expertiseLessons.status, 'active'),
          lessonIds?.length ? inArray(expertiseLessons.id, lessonIds) : undefined,
        ),
      )
      .groupBy(expertiseLessons.id);

    return rows.filter((row) => row.total >= MIN_INSTANCES && row.pending > 0).map((row) => row.id);
  };

  consolidate = async (lessonId: string): Promise<ConsolidationResult> => {
    const [lesson] = await this.db
      .select({
        code: expertiseLessons.code,
        currentRevision: expertiseLessons.currentRevision,
        domainId: expertiseLessons.domainId,
        id: expertiseLessons.id,
        reasonKind: expertiseLessons.reasonKind,
        sections: expertiseLessons.sections,
        title: expertiseLessons.title,
      })
      .from(expertiseLessons)
      .where(eq(expertiseLessons.id, lessonId))
      .limit(1);
    if (!lesson) return { generalized: false, lessonId, note: '', reason: 'no-lesson' };

    const instances = await this.loadInstances(lessonId);
    if (instances.length === 0)
      return { generalized: false, lessonId, note: '', reason: 'no-instances' };
    if (instances.length < MIN_INSTANCES)
      return { generalized: false, lessonId, note: '', reason: 'below-threshold' };

    const shipped = await this.loadShipped(instances.map((instance) => instance.id));
    const { visuals, withheld } = await this.resolveFrames(instances, shipped);
    const frameLabel = new Map(visuals.map((visual, index) => [visual.key, `frame ${index + 1}`]));

    const section = (key: string) => lesson.sections.find((entry) => entry.key === key)?.body ?? '';
    const rendered = [
      `code: ${lesson.code}`,
      `title: ${lesson.title}`,
      section('why') && `reasoning: ${section('why')}`,
      section('limits') && `limits: ${section('limits')}`,
      `reasonKind: ${lesson.reasonKind ?? 'unknown'}`,
    ]
      .filter(Boolean)
      .join('\n');

    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const modelConfig = await resolveExpertiseModelConfig(this.db, this.userId);
    const raw = await ai.generateObject(
      {
        ...chainExpertiseConsolidation({
          instances: instances
            .map((instance, index) => this.renderDelivery(`I${index + 1}`, instance, frameLabel))
            .join('\n\n'),
          lesson: rendered,
          shipped: shipped
            .map((delivery, index) => this.renderDelivery(`S${index + 1}`, delivery, frameLabel))
            .join('\n\n'),
          visuals: visuals.map(({ accessUrl, label }) => ({ accessUrl, label })),
          withheldEvidence: withheld,
        }),
        ...modelConfig,
        schema: EXPERTISE_CONSOLIDATION_JSON_SCHEMA,
      },
      {
        metadata: { trigger: RequestTrigger.Expertise },
        tracing: {
          promptVersion: EXPERTISE_CONSOLIDATION_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.ExpertiseConsolidation,
          schemaName: EXPERTISE_CONSOLIDATION_JSON_SCHEMA.name,
        },
      },
    );
    const result = ConsolidationSchema.parse(raw);
    // Only ever downgrade. Replaying one group twice with an unchanged prompt returned `taste`
    // once and `mechanism` once, and the two are not symmetric: `mechanism` is the permissive
    // value — it is what lets a standard compile into a criterion that blocks a delivery on its
    // own. Ingestion decided this at the lesson's birth from the reviewer's own words, so letting
    // a later pass promote it means a mechanism nobody stated can arm the gate through model
    // noise. Admitting taste needs no such proof.
    const reasonKind =
      lesson.reasonKind === 'taste' && result.reasonKind === 'mechanism'
        ? 'taste'
        : result.reasonKind;
    const shippedIds = shipped.map((delivery) => delivery.id);
    const { boundaries, texts } = resolveLimits(result.limits, shippedIds, {
      isPlaceholder: result.currentLimitsArePlaceholder,
      text: section('limits'),
    });
    const evidence: ExpertiseRevisionEvidence = {
      boundaries,
      instances: instances.map((instance) => instance.id),
      shipped: shippedIds,
    };

    // A refusal is still a pass: recording it is what stops the same instances being re-read on
    // every subsequent rejection, and "these do not share a standard" is the honest answer for a
    // category like placement, where only 11% of complaints repeat.
    if (!result.generalized || !result.title.trim()) {
      await this.db.transaction(async (tx) =>
        this.recordRevision(lesson, lesson.sections, result.note, {
          evidence,
          generalized: false,
          tx,
        }),
      );
      return { generalized: false, lessonId, note: result.note, reason: 'nothing-new' };
    }

    const sections: ExpertiseLessonSection[] = [
      {
        body: result.subject.trim()
          ? `${result.title.trim()}\n\n适用对象：${result.subject.trim()}`
          : result.title.trim(),
        key: 'rule',
      },
      { body: result.reasoning, key: 'why' },
      // The worked example is the one section this pass has no better source for than the lesson
      // already has, so it is carried over rather than regenerated.
      ...lesson.sections.filter((entry) => entry.key === 'how'),
      // Nothing survived resolution → the standard keeps the limits section it already had (the
      // reviewer's own boundary, or ingestion's "not stated" placeholder), rather than losing it.
      ...(texts.length > 0
        ? [{ body: texts.join('\n'), key: 'limits' as const }]
        : lesson.sections.filter((entry) => entry.key === 'limits')),
    ];

    await this.db.transaction(async (tx) => {
      await tx
        .update(expertiseLessons)
        .set({ reasonKind, sections, title: result.title.trim() })
        .where(eq(expertiseLessons.id, lessonId));
      await this.recordRevision(lesson, sections, result.note, { evidence, generalized: true, tx });
    });

    log('consolidated %s: %s -> %s', lesson.code, lesson.title, result.title);
    return { generalized: true, lessonId, note: result.note, title: result.title.trim() };
  };

  /** The rejected deliveries behind this standard, newest first so a growing rule reads current. */
  private loadInstances = async (lessonId: string) => {
    const rows = await this.db
      .select({
        detail: verifyCheckResults.userDecisionDetail,
        example: expertiseHits.example,
        id: verifyCheckResults.id,
        title: verifyCheckResults.checkItemTitle,
      })
      .from(expertiseHits)
      .innerJoin(verifyCheckResults, eq(verifyCheckResults.id, expertiseHits.sourceCheckResultId))
      .where(eq(expertiseHits.lessonId, lessonId))
      .orderBy(desc(expertiseHits.createdAt))
      .limit(MAX_INSTANCES);

    // One check can back a standard through several hits; reading it twice would let a single
    // delivery look like agreement between two.
    const seen = new Set<string>();
    return rows.filter((row) => !seen.has(row.id) && seen.add(row.id));
  };

  /**
   * Deliveries accepted in the same scope, excluding the instances themselves.
   *
   * Readable rounds only. A workspace shares its lesson catalog but not every round in it: a round
   * is creator-only unless it is public, and this pass puts a delivery's title, the reviewer's
   * comments and their circled notes into a prompt — then persists the result as a limit the whole
   * workspace reads. So the sample is restricted the way a reader would be: the caller's own
   * checks, plus other members' only where the round they belong to is public. A check with no
   * round is the caller's own by the scope predicate.
   *
   * Deterministic per owner rather than newest-first: a boundary that appears only because the
   * sample moved is not a boundary, and a re-run has to be comparable with the last one.
   */
  private loadShipped = async (excludeIds: string[]) => {
    const scope = this.workspaceId
      ? eq(verifyCheckResults.workspaceId, this.workspaceId)
      : and(eq(verifyCheckResults.userId, this.userId), isNull(verifyCheckResults.workspaceId));

    return this.db
      .select({
        detail: verifyCheckResults.userDecisionDetail,
        example: sql<null>`null`,
        id: verifyCheckResults.id,
        title: verifyCheckResults.checkItemTitle,
      })
      .from(verifyCheckResults)
      .leftJoin(verifyRuns, eq(verifyRuns.id, verifyCheckResults.verifyRunId))
      .where(
        and(
          scope,
          or(eq(verifyCheckResults.userId, this.userId), eq(verifyRuns.visibility, 'public')),
          eq(verifyCheckResults.userDecision, 'accepted'),
          excludeIds.length > 0 ? notInArray(verifyCheckResults.id, excludeIds) : undefined,
          gt(sql`length(coalesce(${verifyCheckResults.checkItemTitle}, ''))`, 0),
        ),
      )
      .orderBy(sql`md5(${verifyCheckResults.id}::text)`)
      .limit(MAX_SHIPPED);
  };

  private renderDelivery = (
    ref: string,
    delivery: {
      detail: VerifyCheckDecisionDetail | null;
      example?: null | string;
      id: string;
      title: null | string;
    },
    frameLabel: Map<string, string>,
  ) => {
    const regions = (delivery.detail?.annotations ?? []).map((annotation) => {
      const frame = frameLabel.get(`${delivery.id}:${annotation.evidenceId}`);
      const at = annotation.rect
        ? ` at ${pct(annotation.rect.x)},${pct(annotation.rect.y)} sized ${pct(annotation.rect.width)}×${pct(annotation.rect.height)}`
        : '';
      return `  circled${frame ? ` on ${frame}` : ''}${at}: ${annotation.comment?.trim() || '(no note)'}`;
    });
    const frames = [...frameLabel]
      .filter(([key]) => key.startsWith(`${delivery.id}:`))
      .map(([, label]) => label);

    return [
      `[${ref}] promised: ${delivery.title ?? '(untitled check)'}`,
      delivery.detail?.comment?.trim() && `  said: ${delivery.detail.comment.trim()}`,
      ...regions,
      regions.length === 0 && frames.length > 0 && `  shown on ${frames.join(', ')}`,
      delivery.example?.trim() && `  recorded as: ${delivery.example.trim()}`,
    ]
      .filter(Boolean)
      .join('\n');
  };

  /**
   * Frames for both sets, instances first.
   *
   * The order is the budget: dropping a shipped frame costs a boundary this pass might have
   * found, while dropping an instance frame costs the restatement itself.
   */
  private resolveFrames = async (
    instances: { detail: VerifyCheckDecisionDetail | null; id: string }[],
    shipped: { detail: VerifyCheckDecisionDetail | null; id: string }[],
  ) => {
    const fileModel = new FileModel(this.db, this.userId, this.workspaceId);
    const fileService = new FileService(this.db, this.userId, this.workspaceId);
    const evidenceModel = new VerifyEvidenceModel(this.db, this.userId, this.workspaceId);

    const collect = async (
      deliveries: { detail: VerifyCheckDecisionDetail | null; id: string }[],
      kind: 'instance' | 'shipped',
    ) => {
      const out: { fileId: string; key: string; label: string }[] = [];
      for (const [index, delivery] of deliveries.entries()) {
        const circled = new Set(
          (delivery.detail?.annotations ?? []).map((annotation) => annotation.evidenceId),
        );
        const rows = await evidenceModel.listByCheckResult(delivery.id);
        // One frame per delivery on each side: this pass compares many deliveries against one
        // standard, so breadth buys more than a second angle on any single delivery.
        const chosen =
          rows.find((row) => row.type === 'screenshot' && row.fileId && circled.has(row.id)) ??
          rows.find((row) => row.type === 'screenshot' && row.fileId);
        if (!chosen?.fileId) continue;
        out.push({
          fileId: chosen.fileId,
          key: `${delivery.id}:${chosen.id}`,
          label: `${kind === 'instance' ? 'I' : 'S'}${index + 1} — ${kind === 'instance' ? 'rejected' : 'accepted'}`,
        });
      }
      return out;
    };

    const ordered = [
      ...(await collect(instances, 'instance')),
      ...(await collect(shipped, 'shipped')),
    ];
    const selected = ordered.slice(0, MAX_FRAMES);
    const resolved = await pMap(
      selected,
      async (item) => {
        const file = await fileModel.findById(item.fileId);
        if (!file) return null;
        return {
          accessUrl: await resolveModelReadableFrameUrl(fileService, file),
          key: item.key,
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
          ? `${dropped} further screenshot(s) were not attached. A boundary cannot be read off a frame you were not given, so treat their absence as missing information rather than as proof the subject is not there.`
          : undefined,
    };
  };

  private recordRevision = async (
    lesson: { currentRevision?: null | number; id: string; title: string },
    sections: ExpertiseLessonSection[],
    note: string,
    options: { evidence: ExpertiseRevisionEvidence; generalized: boolean; tx: LobeChatDatabase },
  ) => {
    const db = options.tx;
    const [prior] = await db
      .select({ revision: expertiseLessonRevisions.revision })
      .from(expertiseLessonRevisions)
      .where(eq(expertiseLessonRevisions.lessonId, lesson.id))
      .orderBy(desc(expertiseLessonRevisions.revision))
      .limit(1);

    // Both the log's own maximum and the lesson's counter, because a user edit numbers from
    // `currentRevision + 1` against a unique `(lesson, revision)`: leaving the counter behind makes
    // the reviewer's NEXT edit collide, and taking the larger of the two also repairs a lesson
    // whose counter has already drifted.
    const revision = Math.max(prior?.revision ?? 0, lesson.currentRevision ?? 0) + 1;

    await db.insert(expertiseLessonRevisions).values({
      changedBy: 'system',
      evidence: options.evidence,
      feedback: note,
      kind: 'generalize',
      lessonId: lesson.id,
      // The title before the rewrite is what makes a pass auditable at a glance; a refusal keeps
      // the same title on both sides, which is exactly how a refusal should read.
      prevTitle: lesson.title,
      revision,
      sections,
    });
    await db
      .update(expertiseLessons)
      .set({ currentRevision: revision })
      .where(eq(expertiseLessons.id, lesson.id));
    log('recorded %s revision for %s', options.generalized ? 'generalize' : 'no-change', lesson.id);
  };
}
