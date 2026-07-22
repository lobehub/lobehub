import { normalizeVerifySurface, type VerifySurface } from '@lobechat/const/verify';
import type { VerifyCheckItem, VerifyCodingScope } from '@lobechat/types';

import type { VerifyStatus } from '@/database/models/agentOperation';
import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import type { VerifyResultWithEvidence } from '@/services/verify';

export type DockPhase =
  | 'idle'
  | 'draft'
  | 'verifying'
  | 'failed'
  // The verifier could not run (infra error) — a terminal, non-pass state that
  // is NOT a delivery failure. Rendered distinctly so it never reads as "failed".
  | 'errored'
  | 'repairing'
  | 'passed';

/** Map the persisted rollup status to the dock's phase state machine. */
export const phaseFromStatus = (status: VerifyStatus | null | undefined): DockPhase => {
  switch (status) {
    case 'planned': {
      return 'draft';
    }
    case 'verifying': {
      return 'verifying';
    }
    case 'failed': {
      return 'failed';
    }
    case 'repairing': {
      return 'repairing';
    }
    case 'errored': {
      return 'errored';
    }
    case 'passed':
    case 'delivered': {
      return 'passed';
    }
    default: {
      return 'idle';
    }
  }
};

/** Whether a draft plan exists but hasn't been confirmed yet. */
export const isDraftUnconfirmed = (
  status: VerifyStatus | null | undefined,
  confirmedAt: Date | null | undefined,
): boolean => status === 'planned' && !confirmedAt;

/** Display behavior of a check item, mirroring the mock's gate / auto_improve. */
export const itemBehavior = (item: Pick<VerifyCheckItem, 'required'>): 'gate' | 'auto_improve' =>
  item.required ? 'gate' : 'auto_improve';

type Verdict = 'passed' | 'failed' | 'uncertain';

/**
 * What a row of the report's check list can be. `not_executed` is not a verdict
 * the verifier can reach — it's a planned item that produced no result at all,
 * which only became visible once the plan started being stored next to the
 * results. Rendering it is the point: a check that quietly never ran is
 * otherwise indistinguishable from one that was never planned.
 */
export type CheckState = Verdict | 'not_executed';

/**
 * Unresolved-first sort: failed → uncertain → never ran → passed. A planned
 * check that never ran is a hole in the verification, not a mild pass — it
 * belongs with the things still owed the reader, above everything settled.
 */
export const SEVERITY_RANK: Record<CheckState, number> = {
  failed: 0,
  not_executed: 2,
  passed: 3,
  uncertain: 1,
};

export const checkVerdict = (result: VerifyResultWithEvidence): Verdict => {
  const v = result.verdict ?? result.status;
  if (v === 'passed' || v === 'failed' || v === 'uncertain') return v;
  return 'uncertain';
};

/** One row of the report's check list: a planned check, its result, or both. */
export interface CheckRowData {
  /** `checkItemId` — the key the plan and the results agree on. */
  id: string;
  planItem?: VerifyCheckItem;
  result?: VerifyResultWithEvidence;
  state: CheckState;
}

/**
 * The check list, built from the plan and the results together.
 *
 * The plan is the skeleton when there is one: every item it named gets a row,
 * even the ones that produced no result, so a check that was promised and then
 * quietly skipped stays visible instead of disappearing from the report. Cases
 * the run produced without ever planning them are appended — a run may
 * legitimately discover a check midway, and dropping it would hide real
 * findings. With no plan (every report ingested before plans were stored), this
 * degrades to exactly the old behavior: the results, severity-first.
 */
export const buildCheckRows = (
  plan: VerifyCheckItem[] | null,
  results: VerifyResultWithEvidence[],
): CheckRowData[] => {
  const resultsByCheckItem = new Map(results.map((result) => [result.checkItemId, result]));

  const planned: CheckRowData[] = (plan ?? []).map((planItem) => {
    const result = resultsByCheckItem.get(planItem.id);
    return {
      id: planItem.id,
      planItem,
      result,
      state: result ? checkVerdict(result) : ('not_executed' as const),
    };
  });

  const plannedIds = new Set(planned.map((row) => row.id));
  const unplanned: CheckRowData[] = results
    .filter((result) => !plannedIds.has(result.checkItemId))
    .map((result) => ({ id: result.checkItemId, result, state: checkVerdict(result) }));

  return [...planned, ...unplanned].sort((a, b) => SEVERITY_RANK[a.state] - SEVERITY_RANK[b.state]);
};

/**
 * Surfaces worth rendering, as canonical values. History holds 76 distinct
 * free-form strings — prose, runtime modes, tool and test-kind names — none of
 * which read as a badge. Anything that doesn't name a real surface is dropped
 * rather than shown as a mystery chip; known spellings (`electron`) still
 * resolve.
 */
export const renderableSurfaces = (surfaces: VerifyCodingScope['surfaces']): VerifySurface[] => {
  if (!surfaces?.length) return [];

  const seen: VerifySurface[] = [];
  for (const value of surfaces) {
    const surface = normalizeVerifySurface(value);
    if (surface && !seen.includes(surface)) seen.push(surface);
  }
  return seen;
};

const LEADING_UUID_RE = /^[\dA-F]{8}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{12}/i;

/**
 * Salvage the leading UUID from a route param. Chat autolinkers glue trailing
 * CJK punctuation onto shared links (`/acceptance/<uuid>（本轮…`), so the raw
 * param would 404 (and used to 500) even though the link plainly names a real
 * aggregate — extract the id and let the visit succeed. A param with no
 * leading UUID passes through unchanged so genuine not-found stays visible.
 */
export const extractUuid = (raw: string | undefined): string | undefined => {
  if (!raw) return raw;
  return LEADING_UUID_RE.exec(raw)?.[0] ?? raw;
};

/**
 * Resolve the acceptance page's `?r=` deep-link to the round it names. Only a
 * plain non-negative integer that matches an existing round counts — anything
 * else (absent, garbage, an index the chain never reached) resolves to null and
 * the page just shows its default state.
 */
export const resolveRoundParam = <T extends { run: { roundIndex: number | null } }>(
  rounds: T[],
  raw: string | null | undefined,
): T | null => {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const index = Number(raw);
  return rounds.find((round) => round.run.roundIndex === index) ?? null;
};

export interface CheckCounts {
  failed: number;
  passed: number;
  total: number;
}

export const countResults = (results: VerifyCheckResultItem[] = []): CheckCounts => ({
  failed: results.filter((r) => r.status === 'failed' || r.verdict === 'failed').length,
  passed: results.filter((r) => r.status === 'passed' || r.verdict === 'passed').length,
  total: results.length,
});

/** The subset of theme color tokens the verify card tint reads. */
export interface VerifyTintTheme {
  colorBgElevated: string;
  colorError: string;
  colorSuccess: string;
  colorWarning: string;
}

const mix = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/**
 * State-tinted background for the whole verify card, keyed by phase. A soft
 * radial glow anchored to the status corner (top-right, behind the badge) over
 * the container fill — a gentle halo, not a full-width banner. Returns undefined
 * when neutral.
 */
export const phaseCardBackground = (
  phase: DockPhase,
  theme: VerifyTintTheme,
): string | undefined => {
  const glow = (color: string) =>
    `radial-gradient(60% 90% at 100% 0%, ${mix(color, 8)} 0%, ${mix(color, 0)} 52%), ${theme.colorBgElevated}`;
  switch (phase) {
    case 'passed': {
      return glow(theme.colorSuccess);
    }
    case 'failed': {
      return glow(theme.colorError);
    }
    case 'draft':
    case 'verifying':
    case 'errored':
    case 'repairing': {
      return glow(theme.colorWarning);
    }
    default: {
      return undefined;
    }
  }
};
