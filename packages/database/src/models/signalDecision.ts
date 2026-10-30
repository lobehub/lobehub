import type {
  SignalDecisionLabel,
  SignalDecisionLabelMetadata,
  SignalDecisionOutcome,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import type { NewSignalDecision, SignalDecisionItem, SignalDecisionLabelItem } from '../schemas';
import { signalDecisionLabels, signalDecisions, signals } from '../schemas';
import type { LobeChatDatabase } from '../type';

export type RecordSignalDecisionInput = Omit<
  NewSignalDecision,
  'agentId' | 'id' | 'userId' | 'workspaceId'
> & {
  /**
   * Required on purpose. `agent_id` is nullable only because deleting an agent clears it
   * (`ON DELETE SET NULL`); a decision is always made by one agent, and the idempotency key
   * `(signal_id, agent_id, pipeline_version)` cannot hold for a missing one.
   */
  agentId: string;
};

export interface AddSignalDecisionLabelInput {
  actor?: string;
  confidence?: number;
  label: SignalDecisionLabel;
  metadata?: SignalDecisionLabelMetadata;
  /** Who produced the label: `user`, `heuristic`, `llm_judge`, … */
  source: string;
}

/** How far back a scope read looks when the caller does not say. */
export const SCOPE_READ_DEFAULT_DAYS = 30;
/** Longest message preview a scope read returns. */
export const SCOPE_READ_TEXT_PREVIEW = 200;
/** Largest page a scope read returns. */
export const SCOPE_READ_MAX_LIMIT = 50;

/** Keyset position: the last row of the previous page, `createdAt` as ISO with microseconds. */
export interface ScopeDecisionCursor {
  createdAt: string;
  id: string;
}

export interface ListDecisionsByScopeParams {
  cursor?: ScopeDecisionCursor;
  /** Only decisions whose `final_reason` is one of these; ignored when empty. */
  finalReasons?: readonly string[];
  /** `has: true`: only decisions holding a label from source `by`; `has: false`: only those without. */
  labeled?: { by: string; has: boolean };
  /** 1..{@link SCOPE_READ_MAX_LIMIT}; defaults to 20. */
  limit?: number;
  outcome?: SignalDecisionOutcome;
  scopeKey: string;
  /** Lower bound on `created_at`; defaults to {@link SCOPE_READ_DEFAULT_DAYS} days ago. */
  since?: Date;
}

/** The latest label of one source on a decision: that source's current opinion. */
export interface CurrentDecisionLabel {
  createdAt: Date;
  label: SignalDecisionLabel;
  metadata: SignalDecisionLabelMetadata;
  source: string;
}

export interface ScopeDecisionListItem {
  /** Where the message was addressed (`signals.metadata.address`); survives the payload purge. */
  address: Record<string, string> | null;
  createdAt: Date;
  finalReason: string | null;
  id: string;
  /** Current label per source. */
  labels: CurrentDecisionLabel[];
  outcome: SignalDecisionOutcome;
  /** First {@link SCOPE_READ_TEXT_PREVIEW} characters of the message; null once purged. */
  text: string | null;
  /** The retention sweep blanked the message, or its signal is gone. */
  textPurged: boolean;
  toTag: string | null;
}

export interface ScopeDecisionPage {
  items: ScopeDecisionListItem[];
  nextCursor?: ScopeDecisionCursor;
}

export interface SummarizeDecisionsByScopeParams {
  /** Reasons counted as follow-up (unprompted) wakes. */
  followupReasons: readonly string[];
  /** Label sources whose current labels are counted, e.g. `['user', 'agent:no_reply']`. */
  labelSources: readonly string[];
  scopeKey: string;
  since: Date;
}

export interface ScopeDecisionSummary {
  defer: number;
  /** Wakes whose reason is one of `followupReasons`. */
  followupWakes: number;
  /** Count of decisions per `source` → current `label`. */
  labels: Record<string, Partial<Record<SignalDecisionLabel, number>>>;
  skip: number;
  total: number;
  wake: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `created_at` at full (microsecond) precision, so a keyset cursor never skips a row. */
const createdAtIso = sql<string>`to_char(${signalDecisions.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * User-scoped access to `signal_decisions` and their append-only `signal_decision_labels`.
 */
export class SignalDecisionModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Records what the pipeline decided for one signal.
   *
   * Idempotent on `(signal_id, agent_id, pipeline_version)`: a redelivered message returns the
   * decision already stored for the same agent instead of adding a second one. Returns `undefined` when the signal
   * does not belong to this user.
   */
  record = async (input: RecordSignalDecisionInput): Promise<SignalDecisionItem | undefined> => {
    if (!input.agentId) throw new Error('A signal decision needs the agent that made it');

    const [owned] = await this.db
      .select({ id: signals.id })
      .from(signals)
      .where(and(eq(signals.id, input.signalId), eq(signals.userId, this.userId)))
      .limit(1);

    if (!owned) return undefined;

    const [inserted] = await this.db
      .insert(signalDecisions)
      .values({ ...input, userId: this.userId, workspaceId: this.workspaceId })
      .onConflictDoNothing({
        target: [
          signalDecisions.signalId,
          signalDecisions.agentId,
          signalDecisions.pipelineVersion,
        ],
      })
      .returning();

    if (inserted) return inserted;

    const [existing] = await this.db
      .select()
      .from(signalDecisions)
      .where(
        and(
          eq(signalDecisions.signalId, input.signalId),
          eq(signalDecisions.userId, this.userId),
          eq(signalDecisions.agentId, input.agentId),
          eq(signalDecisions.pipelineVersion, input.pipelineVersion),
        ),
      )
      .limit(1);

    return existing;
  };

  findById = async (id: string) => {
    const [row] = await this.db
      .select()
      .from(signalDecisions)
      .where(and(eq(signalDecisions.id, id), eq(signalDecisions.userId, this.userId)))
      .limit(1);

    return row;
  };

  listBySignal = async (signalId: string) =>
    this.db
      .select()
      .from(signalDecisions)
      .where(and(eq(signalDecisions.signalId, signalId), eq(signalDecisions.userId, this.userId)))
      .orderBy(asc(signalDecisions.createdAt));

  /** Links the decision to the run it started. The only field a decision gets after the fact. */
  linkRun = async (id: string, run: { operationId?: string; topicId?: string }) => {
    const [row] = await this.db
      .update(signalDecisions)
      .set({ operationId: run.operationId, topicId: run.topicId })
      .where(and(eq(signalDecisions.id, id), eq(signalDecisions.userId, this.userId)))
      .returning();

    return row;
  };

  /**
   * Appends a label. Never edits or replaces an earlier one; returns `undefined` when the
   * decision is not this user's.
   */
  addLabel = async (
    decisionId: string,
    input: AddSignalDecisionLabelInput,
  ): Promise<SignalDecisionLabelItem | undefined> => {
    if (!(await this.findById(decisionId))) return undefined;

    const [row] = await this.db
      .insert(signalDecisionLabels)
      .values({ ...input, decisionId })
      .returning();

    return row;
  };

  /** Labels newest first. */
  listLabels = async (decisionId: string): Promise<SignalDecisionLabelItem[]> => {
    if (!(await this.findById(decisionId))) return [];

    return this.db
      .select()
      .from(signalDecisionLabels)
      .where(eq(signalDecisionLabels.decisionId, decisionId))
      .orderBy(desc(signalDecisionLabels.createdAt), desc(signalDecisionLabels.id));
  };

  // --------------- Scope reads (one channel's decisions) ---------------

  /**
   * One channel's decisions, newest first, with the message preview and each source's current
   * label. Every predicate starts from `(user_id, scope_key, created_at)`, so the read stays on the
   * composite index; labels come in one extra query for the page's ids.
   */
  listByScope = async (params: ListDecisionsByScopeParams): Promise<ScopeDecisionPage> => {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), SCOPE_READ_MAX_LIMIT);
    const since = params.since ?? new Date(Date.now() - SCOPE_READ_DEFAULT_DAYS * DAY_MS);

    const conditions: SQL[] = [
      eq(signalDecisions.userId, this.userId),
      eq(signalDecisions.scopeKey, params.scopeKey),
      gte(signalDecisions.createdAt, since),
    ];
    if (params.outcome) conditions.push(eq(signalDecisions.outcome, params.outcome));
    if (params.finalReasons?.length)
      conditions.push(inArray(signalDecisions.finalReason, [...params.finalReasons]));
    if (params.cursor)
      conditions.push(
        sql`(${signalDecisions.createdAt}, ${signalDecisions.id}) < (${params.cursor.createdAt}::timestamptz, ${params.cursor.id}::uuid)`,
      );
    if (params.labeled) {
      const exists = sql`exists (select 1 from ${signalDecisionLabels} where ${signalDecisionLabels.decisionId} = ${signalDecisions.id} and ${signalDecisionLabels.source} = ${params.labeled.by})`;
      conditions.push(params.labeled.has ? exists : sql`not ${exists}`);
    }

    const rows = await this.db
      .select({
        address: sql<Record<string, string> | null>`${signals.metadata} -> 'address'`,
        createdAt: signalDecisions.createdAt,
        createdAtIso,
        finalReason: signalDecisions.finalReason,
        id: signalDecisions.id,
        outcome: signalDecisions.outcome,
        purged: sql<boolean>`(${signals.id} is null or ${signals.payloadPurgedAt} is not null)`,
        text: sql<
          string | null
        >`case when ${signals.payloadPurgedAt} is null then left(${signals.payload} ->> 'text', ${SCOPE_READ_TEXT_PREVIEW}) end`,
        toTag: signalDecisions.toTag,
      })
      .from(signalDecisions)
      .leftJoin(signals, eq(signals.id, signalDecisions.signalId))
      .where(and(...conditions))
      .orderBy(desc(signalDecisions.createdAt), desc(signalDecisions.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const labels = await this.currentLabels(page.map((row) => row.id));
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        address: row.address ?? null,
        createdAt: row.createdAt,
        finalReason: row.finalReason,
        id: row.id,
        labels: labels.get(row.id) ?? [],
        outcome: row.outcome,
        text: row.purged ? null : (row.text ?? null),
        textPurged: row.purged,
        toTag: row.toTag,
      })),
      nextCursor:
        rows.length > limit && last ? { createdAt: last.createdAtIso, id: last.id } : undefined,
    };
  };

  /**
   * Counts for one channel since `since`: decisions by outcome, follow-up wakes, and how many
   * decisions each label source currently holds each label for. Two aggregates, both bounded by
   * the `(user_id, scope_key, created_at)` index range.
   */
  summaryByScope = async (
    params: SummarizeDecisionsByScopeParams,
  ): Promise<ScopeDecisionSummary> => {
    const inScope = and(
      eq(signalDecisions.userId, this.userId),
      eq(signalDecisions.scopeKey, params.scopeKey),
      gte(signalDecisions.createdAt, params.since),
    );
    const followup = params.followupReasons.length
      ? inArray(signalDecisions.finalReason, [...params.followupReasons])
      : sql`false`;

    const [counts] = await this.db
      .select({
        defer: sql<number>`count(*) filter (where ${signalDecisions.outcome} = 'defer')::int`,
        followupWakes: sql<number>`count(*) filter (where ${signalDecisions.outcome} = 'wake' and ${followup})::int`,
        skip: sql<number>`count(*) filter (where ${signalDecisions.outcome} = 'skip')::int`,
        total: sql<number>`count(*)::int`,
        wake: sql<number>`count(*) filter (where ${signalDecisions.outcome} = 'wake')::int`,
      })
      .from(signalDecisions)
      .where(inScope);

    const labels: ScopeDecisionSummary['labels'] = {};
    if (params.labelSources.length > 0 && (counts?.total ?? 0) > 0) {
      const current = this.db
        .selectDistinctOn([signalDecisionLabels.decisionId, signalDecisionLabels.source], {
          label: signalDecisionLabels.label,
          source: signalDecisionLabels.source,
        })
        .from(signalDecisionLabels)
        .innerJoin(signalDecisions, eq(signalDecisions.id, signalDecisionLabels.decisionId))
        .where(and(inScope, inArray(signalDecisionLabels.source, [...params.labelSources])))
        .orderBy(
          signalDecisionLabels.decisionId,
          signalDecisionLabels.source,
          desc(signalDecisionLabels.createdAt),
          desc(signalDecisionLabels.id),
        )
        .as('current');

      const grouped = await this.db
        .select({
          count: sql<number>`count(*)::int`,
          label: current.label,
          source: current.source,
        })
        .from(current)
        .groupBy(current.source, current.label);

      for (const row of grouped) {
        (labels[row.source] ??= {})[row.label] = row.count;
      }
    }

    return {
      defer: counts?.defer ?? 0,
      followupWakes: counts?.followupWakes ?? 0,
      labels,
      skip: counts?.skip ?? 0,
      total: counts?.total ?? 0,
      wake: counts?.wake ?? 0,
    };
  };

  /** Current label per source for each decision, keyed by decision id. Callers pass owned ids. */
  private currentLabels = async (decisionIds: string[]) => {
    const byDecision = new Map<string, CurrentDecisionLabel[]>();
    if (decisionIds.length === 0) return byDecision;

    const rows = await this.db
      .selectDistinctOn([signalDecisionLabels.decisionId, signalDecisionLabels.source], {
        createdAt: signalDecisionLabels.createdAt,
        decisionId: signalDecisionLabels.decisionId,
        label: signalDecisionLabels.label,
        metadata: signalDecisionLabels.metadata,
        source: signalDecisionLabels.source,
      })
      .from(signalDecisionLabels)
      .where(inArray(signalDecisionLabels.decisionId, decisionIds))
      .orderBy(
        signalDecisionLabels.decisionId,
        signalDecisionLabels.source,
        desc(signalDecisionLabels.createdAt),
        desc(signalDecisionLabels.id),
      );

    for (const { decisionId, ...label } of rows) {
      const list = byDecision.get(decisionId) ?? [];
      list.push(label);
      byDecision.set(decisionId, list);
    }

    return byDecision;
  };
}
