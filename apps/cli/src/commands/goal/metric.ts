import type { GoalGraphSnapshot, GoalMetricComparison } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import { type Command, Option } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';
import { type GoalReads, goalReads, hasOperationToken } from './reads';

export interface GoalMetricState {
  allMet: boolean;
  criteria: {
    key: string;
    met: boolean;
    observedAt?: number;
    op: string;
    target: number;
    title?: string;
    value: number | null;
  }[];
}

const comparisons = ['gte', 'lte', 'gt', 'lt', 'eq'] as const satisfies GoalMetricComparison[];

const opSymbol: Record<string, string> = { eq: '=', gt: '>', gte: '≥', lt: '<', lte: '≤' };

/**
 * The measured clauses beside the values the acceptance gate reads, or
 * undefined for a goal that declares none. The graph carries only the
 * declarations, so without this a reader cannot tell a clause nobody measured
 * from one a person already recorded.
 */
export const readMetricState = async (
  reads: GoalReads,
  graph: GoalGraphSnapshot,
): Promise<GoalMetricState | undefined> => {
  if (!graph.goal.config?.acceptance?.metrics?.length) return undefined;
  try {
    return (await reads.metricState.query({ id: graph.goal.id })).data;
  } catch (error) {
    // The CLI ships apart from the server: one without this read must not take
    // `lh goal show` down with it. Any other failure is a real one — a show
    // that silently omits the values would read as "nothing recorded".
    if (isMissingProcedure(error)) return undefined;
    throw error;
  }
};

/** The server predates this read: tRPC answers an unknown path with NOT_FOUND. */
const isMissingProcedure = (error: unknown) =>
  error instanceof TRPCClientError &&
  error.data?.code === 'NOT_FOUND' &&
  error.message.includes('No procedure found');

export const describeMetric = (criterion: GoalMetricState['criteria'][number]) => {
  const reading =
    criterion.value === null
      ? pc.yellow('no observation')
      : `${criterion.value}${criterion.met ? pc.green(' (met)') : pc.yellow(' (not met)')}`;
  const name = criterion.title ? `${criterion.key} ${pc.dim(criterion.title)}` : criterion.key;
  return `${name} ${opSymbol[criterion.op] ?? criterion.op} ${criterion.target}: ${reading}`;
};

export const printMetricState = (state: GoalMetricState) => {
  console.log(pc.dim('Measured acceptance:'));
  for (const criterion of state.criteria) console.log(`  ${describeMetric(criterion)}`);
};

/**
 * Writes go through the owner's login only. A planning run holding an
 * operation token must not record the number that clears its own gate.
 */
const ownerClient = async () => {
  if (hasOperationToken())
    throw new Error(
      'Measured acceptance is written by the goal owner. Ask the owner to record or remove it on the goal page, or with their own `lh goal metric` login.',
    );
  return getTrpcClient();
};

/** Measured acceptance: numeric clauses the goal is only achieved once they hold. */
export function registerGoalMetricCommands(goal: Command) {
  const metric = goal
    .command('metric')
    .description('Measured acceptance: list, record, declare or remove numeric clauses');

  metric
    .command('list <id>')
    .description('Show each measured clause with the latest observation the gate reads')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: boolean | string }) => {
      const { data } = await (await goalReads()).metricState.query({ id });
      if (options.json !== undefined) return outputJson(data, options.json);
      if (data.criteria.length === 0) return log.info('This goal declares no measured clauses.');
      printMetricState(data);
    });

  metric
    .command('record <id> <key> <value>')
    .description('Record an observation for a measured clause')
    .option('--title <text>', 'Human-facing series name')
    .option('--unit <unit>', 'Unit of the value, e.g. ms')
    .action(async (id: string, key: string, raw: string, options) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`<value> must be a number; got ${raw}`);
      const result = await (
        await ownerClient()
      ).goal.recordObservation.mutate({ id, key, title: options.title, unit: options.unit, value });
      log.info(`${result.message}: ${key} = ${value}`);
    });

  metric
    .command('set <id> <key>')
    .description('Declare or update one measured clause; other clauses are kept')
    .requiredOption('--target <n>', 'Threshold the latest observation is compared with')
    .addOption(new Option('--op <op>', 'Comparison').choices(comparisons).default('gte'))
    .option('--title <text>', 'Human-facing name')
    .action(
      async (
        id: string,
        key: string,
        options: { op: GoalMetricComparison; target: string; title?: string },
      ) => {
        const target = Number(options.target);
        if (!Number.isFinite(target))
          throw new Error(`--target must be a number; got ${options.target}`);
        const result = await (
          await ownerClient()
        ).goal.setMetricCriteria.mutate({
          id,
          metrics: [{ key, op: options.op, target, title: options.title }],
          mode: 'merge',
        });
        log.info(`${result.message}: ${key} ${opSymbol[options.op]} ${target}`);
      },
    );

  metric
    .command('remove <id> <keys...>')
    .description('Remove measured clauses so they no longer gate acceptance')
    .action(async (id: string, keys: string[]) => {
      const result = await (await ownerClient()).goal.removeMetricCriteria.mutate({ id, keys });
      log.info(`${result.message}: ${keys.join(', ')}`);
    });
}
