import type { AgentEvalRunListItem, EvalRunConfig } from '@lobechat/types';

import {
  describeSettings,
  isRunActive,
  isRunOnCaseVersion,
  RANK_ATTEMPTS,
  type RankableSet,
  runCoversSet,
  type RunStats,
  runStats,
  stableJson,
} from '@/features/LobeBench/lobeBench';
import { isRunGradingComplete } from '@/features/LobeBench/overviewResults';

export interface RankedContender extends RunStats {
  /** Attempts per case the run made; it ranks on `RANK_ATTEMPTS` of them. */
  attempts: number;
  /** The contender's label: the run's name, else its model, else its target Agent. */
  name: string;
  /** The best completed run the row stands for. */
  run: AgentEvalRunListItem;
}

export interface SetRanking {
  /** Runs still pending or running on the set; the ranking changes when they finish. */
  active: number;
  /**
   * Completed full runs that errored on every case (a missing API key, a dead
   * tool service): they say nothing about the model, so they are not ranked.
   */
  broken: number;
  /** Each contender's best completed, judged run on the whole set, best first. */
  contenders: RankedContender[];
  /** Completed runs of fewer attempts per case than a leaderboard ranks on. */
  fewAttempts: number;
  /**
   * Runs on the set made on an earlier version of its cases (or before runs recorded
   * one): cases are edited in place, so only runs on the current version rank.
   */
  outdated: number;
  /** Completed, judged full runs the ranking is drawn from. */
  ranked: number;
  /** Completed full runs whose judging has not finished; they are not ranked yet. */
  unjudged: number;
}

export const contenderName = (run: AgentEvalRunListItem) => {
  const config = (run.config ?? {}) as { model?: string };
  return run.name || config.model || run.targetAgent?.title || run.targetAgent?.id || 'Unknown';
};

/**
 * Who a run stands for on a leaderboard: the model and every setting it ran
 * with (sampling, reasoning, step and time limits), never the name it was
 * given; every run ranks on the same number of attempts, so they are not
 * part of it. The same model with another setting is another contender, and
 * two names for one setup are one. A run of an Agent stands for that Agent;
 * one with neither falls back to its name.
 */
export const contenderKeyOf = (run: AgentEvalRunListItem) => {
  const config = (run.config ?? {}) as EvalRunConfig;
  const agentId = run.targetAgentId ?? run.targetAgent?.id;
  return stableJson({
    judgeModel: config.judgeModel,
    judgeProvider: config.judgeProvider,
    maxSteps: config.maxSteps,
    timeout: config.timeout,
    ...(config.model
      ? {
          chatConfig: config.chatConfig ?? {},
          model: config.model,
          params: config.params ?? {},
          provider: config.provider,
        }
      : agentId
        ? { agentId }
        : { name: contenderName(run) }),
  });
};

/** The setup a row stands for, to tell apart two rows that were given the same name. */
const setupLabelOf = (run: AgentEvalRunListItem) => {
  const config = (run.config ?? {}) as EvalRunConfig;
  return [
    config.provider,
    describeSettings(config.params, config.chatConfig) || 'default settings',
    config.maxSteps !== undefined && `${config.maxSteps} steps`,
    config.timeout !== undefined && `${Math.round(config.timeout / 60_000)} min`,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * A run's standing on `RANK_ATTEMPTS` attempts per case: cases passing all of
 * them and at least one, from the run's unbiased estimates (`passAllAt`), so a
 * run of 5 attempts ranks beside runs of 3. A run of fewer attempts has none.
 */
export const rankedStatsOf = (run: AgentEvalRunListItem): RunStats | undefined => {
  const stats = runStats(run);
  if (stats.k < RANK_ATTEMPTS) return undefined;
  const metrics = (run.metrics ?? {}) as {
    passAllAt?: Record<string, number>;
    passAnyAt?: Record<string, number>;
  };
  const all = metrics.passAllAt?.[String(RANK_ATTEMPTS)];
  // Runs finished before the estimate was recorded: only one of exactly as many attempts says it.
  if (all === undefined) return stats.k === RANK_ATTEMPTS ? stats : undefined;
  const any = metrics.passAnyAt?.[String(RANK_ATTEMPTS)];
  const cases = (share: number) => Math.round(share * stats.total * 10) / 10;
  return {
    ...stats,
    allK: cases(all),
    anyK: any === undefined ? stats.anyK : cases(any),
    k: RANK_ATTEMPTS,
    passRate: all,
    passed: cases(all),
  };
};

const finishedAt = (run: AgentEvalRunListItem) =>
  new Date(run.updatedAt ?? run.createdAt ?? 0).getTime();

/** Unknown cost sorts last among equals without turning the comparison into NaN. */
const costOf = (entry: RankedContender) => entry.perCaseCost ?? Number.MAX_VALUE;

/** Best first: more cases passed, then more passed on any attempt, then cheaper per case, then newer. */
export const compareContenders = (a: RankedContender, b: RankedContender) =>
  b.passed - a.passed ||
  (b.anyK ?? 0) - (a.anyK ?? 0) ||
  costOf(a) - costOf(b) ||
  finishedAt(b.run) - finishedAt(a.run);

/**
 * Who leads on one case set: each contender's best completed run over the
 * whole set, ranked by cases passed. A contender is a setup, not a name
 * (`contenderKeyOf`). A run that picked some cases says nothing
 * about the set and is left out. Only runs on the
 * current version of the cases rank; a completed run whose
 * judging has not finished is counted but not ranked, as is one that errored
 * on every case. Every run ranks on `RANK_ATTEMPTS` attempts per case: a case
 * counts when it passes all of them (`rankedStatsOf`); a run of fewer attempts
 * is counted but not ranked.
 */
export const rankContenders = (
  runs: AgentEvalRunListItem[],
  set: string | Pick<RankableSet, 'caseVersion' | 'id'>,
): SetRanking => {
  const target = typeof set === 'string' ? { id: set } : set;
  const best = new Map<string, RankedContender>();
  let active = 0;
  let broken = 0;
  let fewAttempts = 0;
  let outdated = 0;
  let ranked = 0;
  let unjudged = 0;
  for (const run of runs) {
    if (!runCoversSet(run, target)) continue;
    if (!isRunOnCaseVersion(run, target)) {
      outdated += 1;
      continue;
    }
    if (isRunActive(run.status)) {
      active += 1;
      continue;
    }
    if (run.status !== 'completed') continue;
    const stats = runStats(run);
    if (run.hasUnverifiedAttempts || stats.errors > 0 || (run.metrics?.timeoutCases ?? 0) > 0) {
      broken += 1;
      continue;
    }
    if (!isRunGradingComplete(run)) {
      unjudged += 1;
      continue;
    }
    const onRankAttempts = rankedStatsOf(run);
    if (!onRankAttempts) {
      fewAttempts += 1;
      continue;
    }
    ranked += 1;
    const entry: RankedContender = {
      ...onRankAttempts,
      attempts: stats.k,
      name: contenderName(run),
      run,
    };
    const key = contenderKeyOf(run);
    const prev = best.get(key);
    if (!prev || compareContenders(entry, prev) < 0) best.set(key, entry);
  }
  const contenders = [...best.values()].sort(compareContenders);
  // Rows of different setups that were given one name say which setup they are.
  const named = new Map<string, number>();
  for (const entry of contenders) named.set(entry.name, (named.get(entry.name) ?? 0) + 1);
  for (const entry of contenders) {
    if ((named.get(entry.name) ?? 0) > 1) entry.name = `${entry.name} (${setupLabelOf(entry.run)})`;
  }
  return {
    active,
    broken,
    contenders,
    fewAttempts,
    outdated,
    ranked,
    unjudged,
  };
};

/**
 * The set the page ranks on until the reader picks one: the set with the most
 * ranked contenders, the first listed (the benchmark's published set) on a tie.
 */
export const pickRankedSet = <T extends { id: string }>(
  sets: T[],
  rankings: Map<string, SetRanking>,
): T | undefined =>
  sets.reduce<T | undefined>((top, set) => {
    if (!top) return set;
    const count = rankings.get(set.id)?.contenders.length ?? 0;
    const topCount = rankings.get(top.id)?.contenders.length ?? 0;
    return count > topCount ? set : top;
  }, undefined);
