import { normalizeVerifySurface } from '@lobechat/const/verify';
import type {
  AcceptanceCheckGroup,
  VerifyAgentPlanConfig,
  VerifyCheckItem,
  VerifyCheckTally,
  VerifySurface,
} from '@lobechat/types';

/**
 * The fields of a result row the union reads. The server passes its Drizzle
 * rows; a local report passes rows it assembled from `result.json`. Both get
 * their own row type back on `AcceptanceCheckRow.result`.
 */
export interface CheckUnionResult {
  checkItemId: string;
  checkItemTitle: string | null;
  id: string;
  required: boolean;
  status: string;
  verdict: string | null;
}

/** The fields of a round's run the union reads. */
export interface CheckUnionRun {
  id: string;
  plan: VerifyCheckItem[] | null;
  roundIndex: number | null;
}

// ============================================
// Union view — the cross-round check merge (P-14: the complete inventory of
// acceptance checks, each with its final verdict + evidence; rounds demoted to
// provenance). Deterministically computed at read time — never stored, so it
// can't go stale.
// ============================================

type CheckState = 'passed' | 'failed' | 'uncertain' | 'not_executed';

const resultState = (result: CheckUnionResult): CheckState => {
  const v = result.verdict ?? result.status;
  if (v === 'passed' || v === 'failed' || v === 'uncertain') return v;
  return 'uncertain';
};

export interface AcceptanceCheckHistoryEntry {
  roundIndex: number;
  state: CheckState;
  verifyRunId: string;
}

/**
 * One executed step of a check's iteration timeline. Carries the title THAT
 * round used (a superseded item keeps its own wording) so the evolution reads
 * as written, newest rendered first by the viewer.
 */
export interface AcceptanceTimelineEntry {
  /** The result row backing this step — the key its evidence attaches by. */
  resultId: string;
  roundIndex: number;
  state: CheckState;
  title: string;
  verifyRunId: string;
}

/** One row of the acceptance union: a check item merged across every round. */
export interface AcceptanceCheckRow<R extends CheckUnionResult = CheckUnionResult> {
  /**
   * Set when the item was planned in rounds AFTER the one that produced its
   * final result (it was carried forward without a re-run): the round the
   * evidence actually comes from.
   */
  carriedFromRound?: number;
  /** Grouping key for the union view (harness-authored page section / domain). */
  category: string | null;
  /** Passed now, but failed in at least one earlier round — a repaired check. */
  fixed: boolean;
  /** Verdict trail across rounds, oldest first — only rounds that produced a result. */
  history: AcceptanceCheckHistoryEntry[];
  /** The `checkItemId` every round agrees on (the successor id after folding). */
  id: string;
  /** First round whose plan (or results) named this check (or one it supersedes). */
  introducedAtRound: number;
  /** The latest plan snapshot of this item (carries method/expected/requiredEvidence). */
  planItem?: VerifyCheckItem;
  required: boolean;
  /** The final (latest-round) result row, or undefined when the item never ran. */
  result?: R;
  /** Round the final result came from. */
  resultRound?: number;
  /** How many executed steps the timeline holds (re-runs + folded generations). */
  revisions: number;
  /**
   * Stable 1-based label across the whole union ("C3") — first-appearance
   * order over the round chain, so earlier rounds' numbering never shifts when
   * a new round lands. Feedback and annotations reference checks by it.
   * (Folding a superseded generation removes its row, so numbering after the
   * folded id shifts by one — the successor keeps its own slot.)
   */
  seq: number;
  /** Final cross-round state — what the decision is made on. */
  state: CheckState;
  /** Ids folded into this row via `supersedes` declarations. */
  supersededIds: string[];
  /** Per-item product surface (from the plan item's `verifierConfig.surface`). */
  surface: VerifySurface | null;
  /** The executed steps, oldest first — drives the iteration-history timeline. */
  timeline: AcceptanceTimelineEntry[];
  title: string;
  /** The wording evolved across the timeline (a real iteration, not a re-run). */
  titleChanged: boolean;
}

interface RoundInput<R extends CheckUnionResult> {
  results: R[];
  run: CheckUnionRun;
}

const itemSurface = (item: VerifyCheckItem | undefined): VerifySurface | null => {
  const raw = (item?.verifierConfig as VerifyAgentPlanConfig | undefined)?.surface;
  return typeof raw === 'string' ? normalizeVerifySurface(raw) : null;
};

/**
 * Merge a whole round chain into the union check list.
 *
 * Alignment is two-layered, both harness-authored (no fuzzy matching):
 * - the stable `checkItemId` aligns re-runs of the same check across rounds;
 * - a plan item's `supersedes` folds the ids of checks it REPLACES into this
 *   item's iteration timeline, so a semantically-dead older wording stops
 *   showing up as its own row.
 */
export const buildAcceptanceCheckUnion = <R extends CheckUnionResult>(
  rounds: RoundInput<R>[],
  groups: AcceptanceCheckGroup[] = [],
): AcceptanceCheckRow<R>[] => {
  const ordered = [...rounds].sort((a, b) => (a.run.roundIndex ?? 0) - (b.run.roundIndex ?? 0));

  const rows = new Map<string, AcceptanceCheckRow<R>>();
  // Last round whose PLAN named each item — drives the carried-forward flag.
  const lastPlannedRound = new Map<string, number>();
  // A `supersedes` entry names the check the author knew: often the plan item id
  // they wrote, while the row is keyed by the criterion minted for it. Remember
  // every plan item id's row so the fold below resolves either spelling.
  const logicalIdByPlanItemId = new Map<string, string>();

  const ensureRow = (id: string, roundIndex: number): AcceptanceCheckRow<R> => {
    const existing = rows.get(id);
    if (existing) return existing;
    const row: AcceptanceCheckRow<R> = {
      category: null,
      fixed: false,
      history: [],
      id,
      introducedAtRound: roundIndex,
      required: true,
      revisions: 0,
      seq: 0,
      state: 'not_executed',
      supersededIds: [],
      surface: null,
      timeline: [],
      title: id,
      titleChanged: false,
    };
    rows.set(id, row);
    return row;
  };

  for (const { results, run } of ordered) {
    const roundIndex = run.roundIndex ?? 0;
    const plan = run.plan ?? [];
    const planById = new Map(plan.map((item) => [item.id, item]));
    const logicalIdByCheckItemId = new Map(
      plan.map((item) => [
        item.id,
        item.sourceFlowNode ? item.id : (item.sourceCriterionId ?? item.id),
      ]),
    );

    for (const item of plan) {
      const logicalId = item.sourceFlowNode ? item.id : (item.sourceCriterionId ?? item.id);
      const row = ensureRow(logicalId, roundIndex);
      logicalIdByPlanItemId.set(item.id, logicalId);
      // The latest snapshot wins: repair rounds may refine method/expected.
      if (item.sourceFlowNode) {
        // A rerun is a fresh execution; historical evidence stays in the timeline.
        row.result = undefined;
        row.resultRound = undefined;
      }
      row.planItem = item;
      row.title = item.title;
      row.required = item.required;
      row.category = item.category ?? row.category;
      row.surface = itemSurface(item) ?? row.surface;
      lastPlannedRound.set(logicalId, roundIndex);
    }

    for (const result of results) {
      const logicalId = logicalIdByCheckItemId.get(result.checkItemId) ?? result.checkItemId;
      const row = ensureRow(logicalId, roundIndex);
      const state = resultState(result);
      // The title THIS round used — the current round's snapshot, not the final one.
      const roundTitle =
        planById.get(result.checkItemId)?.title ?? result.checkItemTitle ?? row.title;
      row.history.push({ roundIndex, state, verifyRunId: run.id });
      row.timeline.push({
        resultId: result.id,
        roundIndex,
        state,
        title: roundTitle,
        verifyRunId: run.id,
      });
      row.result = result;
      row.resultRound = roundIndex;
      if (!row.planItem && result.checkItemTitle) row.title = result.checkItemTitle;
      if (!row.planItem) row.required = result.required;
    }
  }

  // Fold superseded generations into their successor's timeline, in round
  // order so a chain (C replaced by B replaced by A) collapses fully into A.
  const foldOrder = [...rows.values()].sort((a, b) => a.introducedAtRound - b.introducedAtRound);
  for (const row of foldOrder) {
    const supersedes = (row.planItem?.supersedes ?? []).map((id) =>
      rows.has(id) ? id : (logicalIdByPlanItemId.get(id) ?? id),
    );
    for (const oldId of supersedes) {
      const old = rows.get(oldId);
      if (!old || old === row) continue;
      row.timeline = [...old.timeline, ...row.timeline].sort((a, b) => a.roundIndex - b.roundIndex);
      row.history = [...old.history, ...row.history].sort((a, b) => a.roundIndex - b.roundIndex);
      row.introducedAtRound = Math.min(row.introducedAtRound, old.introducedAtRound);
      row.supersededIds = [...row.supersededIds, ...old.supersededIds, old.id];
      // The successor's own state stands; a never-run successor inherits the
      // superseded item's final result so the row still shows evidence.
      if (!row.result && old.result) {
        row.result = old.result;
        row.resultRound = old.resultRound;
      }
      rows.delete(oldId);
    }
  }

  // Number the surviving rows by first appearance (Map insertion order) —
  // stable as rounds accrue, because a new round only appends new ids.
  let seq = 0;
  for (const row of rows.values()) row.seq = ++seq;

  for (const row of rows.values()) {
    row.state = row.result ? resultState(row.result) : 'not_executed';
    row.fixed = row.state === 'passed' && row.history.some((entry) => entry.state === 'failed');
    row.revisions = row.timeline.length;
    row.titleChanged = row.timeline.some((entry) => entry.title !== row.title);
    // Carried forward: a later round still planned the item but never re-ran it,
    // so the final evidence predates the current round.
    const planned = lastPlannedRound.get(row.id);
    if (row.resultRound !== undefined && planned !== undefined && planned > row.resultRound) {
      row.carriedFromRound = row.resultRound;
    }
  }

  // Organization belongs to the current acceptance, not its immutable execution
  // snapshots. Preserve IDs, numbering and result references when a check moves.
  const grouped = new Map<string, AcceptanceCheckRow<R>>();
  for (const group of groups) {
    for (const id of group.checkItemIds) {
      const row = rows.get(id);
      if (row) grouped.set(id, { ...row, category: group.title });
    }
  }
  return [...grouped.values(), ...[...rows.values()].filter((row) => !grouped.has(row.id))];
};

/**
 * The union's own three-way split, counted — the number a summary can show
 * without opening the list.
 *
 * It counts UNION ROWS, not one round's result rows. A repair round re-runs the
 * check it was asked to fix and carries the rest forward, so the current round's
 * rows are a subset of the union: counting them would print "1 passed" beside a
 * list that expands to the repaired check plus everything it carried, and the
 * two readings of one acceptance would contradict each other.
 */
export const tallyCheckUnion = (checks: AcceptanceCheckRow[]): VerifyCheckTally => {
  let failed = 0;
  let passed = 0;
  let unjudged = 0;
  for (const check of checks) {
    if (check.state === 'passed') passed++;
    else if (check.state === 'failed') failed++;
    // `uncertain` and `not_executed` are both "planned, never judged" — the same
    // split the acceptance's criteria list draws.
    else unjudged++;
  }
  return { failed, passed, total: checks.length, unjudged };
};
