import { z } from 'zod';

/**
 * The structured storyline of a finished Goal, written by the wrap-up agent
 * once the Goal-level acceptance has ended.
 *
 * Only narrative and references live here. Whether a criterion passed and what
 * a person decided are NOT copied in: the page reads those from the verify
 * records and `goal_node_decisions`, so the report can never disagree with them.
 */
const idList = z.array(z.string().trim().min(1)).max(200);

/**
 * The shapes a client uses to say "this id is not set". A wrap-up agent reads
 * "Final deliverable: none linked to the graph." and copies a placeholder into
 * `deliverableWorkId` instead of omitting the field, so a Goal that produced no
 * deliverable could never submit its report. All of these mean the same as
 * leaving the field out.
 */
const NO_VALUE_TOKENS = new Set(['', '-', '—', 'n/a', 'na', 'nil', 'none', 'null', 'undefined']);

/**
 * An optional id that folds the "no value" shapes into absence: `null`, an
 * empty or blank string, and a placeholder such as `"none"` all parse as
 * `undefined`, exactly as if the field were omitted. Anything else must still be
 * a real, non-empty id — a wrong id is rejected downstream, not silently
 * dropped.
 */
const optionalId = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '' || NO_VALUE_TOKENS.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}, z.string().trim().min(1).optional());

export const goalReportDetourKinds = ['dead_end', 'superseded', 'retry'] as const;
export type GoalReportDetourKind = (typeof goalReportDetourKinds)[number];

export const GoalReportDetourSchema = z
  .object({
    kind: z.enum(goalReportDetourKinds),
    lesson: z.string().trim().min(1).max(2000),
    nodeIds: idList.min(1),
    reason: z.string().trim().min(1).max(2000),
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type GoalReportDetour = z.infer<typeof GoalReportDetourSchema>;

export const GoalReportChapterSchema = z
  .object({
    detours: z.array(GoalReportDetourSchema).max(20).default([]),
    findingIds: idList.default([]),
    narrative: z.string().trim().min(1).max(8000),
    nodeIds: idList.default([]),
    title: z.string().trim().min(1).max(200),
    workVersionIds: idList.default([]),
  })
  .strict();
export type GoalReportChapter = z.infer<typeof GoalReportChapterSchema>;

export const GoalReportNextStepSchema = z
  .object({
    nodeIds: idList.optional(),
    reason: z.string().trim().min(1).max(2000),
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type GoalReportNextStep = z.infer<typeof GoalReportNextStepSchema>;

/**
 * The path that actually carried the Goal to its result, marked by the wrap-up
 * agent: the resolved nodes on it and the edges between them. It lives on the
 * report version rather than on `goal_nodes`, so a rewritten storyline replaces
 * it whole and no stale mark outlives the story that drew it.
 */
export const GoalReportMainlineSchema = z
  .object({
    edgeIds: idList.default([]),
    nodeIds: idList.min(1),
  })
  .strict();
export type GoalReportMainline = z.infer<typeof GoalReportMainlineSchema>;

export const GoalReportMetadataSchema = z
  .object({
    chapters: z.array(GoalReportChapterSchema).min(1).max(30),
    /**
     * The Goal's final deliverable, when it produced one. A placeholder such as
     * `""` or `"none"` is read as "no deliverable" rather than rejected, so a
     * Goal without one can still report.
     */
    deliverableWorkId: optionalId,
    /** The newest `goal_events.id` the report was written against. */
    graphCursor: z.string().trim().min(1),
    headline: z.string().trim().min(1).max(500),
    /** Optional only so versions written before it existed still parse; a new submission must carry it. */
    mainline: GoalReportMainlineSchema.optional(),
    nextSteps: z.array(GoalReportNextStepSchema).max(20).default([]),
  })
  .strict();
export type GoalReportMetadata = z.infer<typeof GoalReportMetadataSchema>;

/**
 * Where the Goal's wrap-up stands, as the page needs it:
 *
 * - `running`   — a report run is in flight for the latest acceptance result.
 * - `completed` — a report version was submitted for the latest acceptance result.
 * - `failed`    — the run ended, failed or timed out without a report. The Goal's
 *                 own status is unaffected; the page falls back to its derived view.
 */
export type GoalReportStatus = 'completed' | 'failed' | 'running';

/** Which acceptance result a wrap-up run was dispatched for. */
export type GoalReportTrigger = 'accepted' | 'acceptance_failed' | 'goal_canceled' | 'goal_failed';

/** Coordinator-owned receipt of the latest wrap-up dispatch, kept on `goal.config.report`. */
export interface GoalReportDispatch {
  /** Stable identity of the acceptance result; one dispatch per key. */
  acceptanceKey: string;
  dispatchedAt: string;
  /** Why the run could not be started, when it could not. */
  error?: string;
  nodeId: string;
  operationId?: string;
  taskId?: string;
  trigger: GoalReportTrigger;
}

export interface GoalReportVersion {
  content: string | null;
  createdAt: Date;
  metadata: GoalReportMetadata;
  version: number;
  workId: string;
  workVersionId: string;
}

/** The wrap-up state a goal graph read carries. */
export interface GoalReportState {
  dispatch: GoalReportDispatch;
  /** Newest report version, whichever acceptance result it was written for. */
  latest?: GoalReportVersion;
  status: GoalReportStatus;
}
