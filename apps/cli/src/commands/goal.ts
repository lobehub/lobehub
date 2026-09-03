import type {
  GoalEdgeKind,
  GoalGraphDecision,
  GoalGraphSnapshot,
  GoalNodeKind,
  GoalTickResult,
} from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { resolveAppUrlBuilder } from './task/url';

// Typed rather than inferred: an `as const` map is indexable by a widened
// `any` node kind, which is how a renamed kind silently printed `undefined`
// here after the type checker had signed off everywhere else.
const nodeIcon: Record<GoalNodeKind, string> = {
  decision: '◆',
  finding: '●',
  problem: '◇',
  task: '▣',
};
/**
 * Every edge kind reads `source <kind> target`, so a row listing its INCOMING
 * edges by kind states the relationship backwards: an incoming `depends_on`
 * means the other node depends on THIS one, not the reverse. Render the inverse
 * verb instead, so each entry is a true sentence about the row it sits on.
 */
const inverseEdgeLabel: Record<GoalEdgeKind, string> = {
  contradicts: 'contradicted by',
  decomposes: 'part of',
  depends_on: 'blocks',
  investigates: 'investigated by',
  leads_to: 'follows',
  produces: 'produced by',
  supports: 'supported by',
};

const terminalOutcomes = new Set(['achieved', 'waiting_human', 'no_progress', 'failed']);

/** Backoff bounds for a transient `goal tick` failure. */
const TICK_RETRY_BASE_MS = 1000;
const TICK_RETRY_MAX_MS = 30_000;

/**
 * tRPC codes that are a verdict about the REQUEST, not about the trip to the
 * server: retrying them just reproduces the same answer. Everything else —
 * including a transport failure that never reached tRPC — is treated as a blip
 * worth surviving, because `goal run` is meant to be left unattended for hours
 * and a dropped socket must not end the run half-way.
 */
const fatalTickCodes = new Set([
  'BAD_REQUEST',
  'CONFLICT',
  'FORBIDDEN',
  'NOT_FOUND',
  'PARSE_ERROR',
  'UNAUTHORIZED',
]);

const trpcErrorCode = (error: unknown): string | undefined => {
  const value = error as { data?: { code?: string }; shape?: { data?: { code?: string } } };
  return value?.data?.code ?? value?.shape?.data?.code;
};

/**
 * A transport-level failure (`fetch failed`, ECONNRESET, a 502 from a proxy)
 * carries no tRPC envelope at all, so the ABSENCE of a code is the signal that
 * the request never got a verdict. Erring towards retry keeps an unrecognised
 * error shape from killing a multi-hour run.
 */
const isRetryableTickError = (error: unknown) => {
  const code = trpcErrorCode(error);
  return code === undefined || !fatalTickCodes.has(code);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run one coordinator tick, riding out transient failures until `retryWindowMs`
 * of CONSECUTIVE failure has elapsed. The window is wall-clock rather than an
 * attempt count so a long outage is survivable without making the backoff
 * pointlessly aggressive; each delay is also clamped to what's left of the
 * window so the command never sleeps past its own budget (and so a tiny window
 * stays fast instead of blocking on the first 1s backoff).
 */
const tickWithRetry = async <T>(
  tick: () => Promise<T>,
  retryWindowMs: number,
  onRetry: (error: unknown, delayMs: number) => void,
): Promise<T> => {
  const deadline = Date.now() + retryWindowMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await tick();
    } catch (error) {
      const remaining = deadline - Date.now();
      if (!isRetryableTickError(error) || remaining <= 0) throw error;
      const delay = Math.min(TICK_RETRY_BASE_MS * 2 ** attempt, TICK_RETRY_MAX_MS, remaining);
      onRetry(error, delay);
      await sleep(delay);
    }
  }
};

interface GoalRunTickResult extends GoalTickResult {
  pollCount?: number;
  waitedMs?: number;
}

const isSameWaitingState = (previous: GoalRunTickResult | undefined, current: GoalTickResult) =>
  previous?.outcome === 'waiting_external' &&
  current.outcome === 'waiting_external' &&
  previous.message === current.message &&
  previous.nodeId === current.nodeId &&
  previous.taskId === current.taskId;

function printGraph(graph: GoalGraphSnapshot) {
  console.log(`\n${pc.bold(graph.goal.title)} ${pc.dim(graph.goal.id)} [${graph.goal.status}]`);
  if (graph.goal.requirement) console.log(`${pc.dim('Requirement:')} ${graph.goal.requirement}`);
  const incoming = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.targetNodeId) ?? [];
    list.push(edge);
    incoming.set(edge.targetNodeId, list);
  }
  const rows = graph.nodes.map((node) => {
    const relations = (incoming.get(node.id) ?? [])
      .map((edge) => `${inverseEdgeLabel[edge.kind] ?? edge.kind} ${edge.sourceNodeId.slice(0, 8)}`)
      .join(', ');
    return [
      `${nodeIcon[node.kind]} ${node.kind}`,
      node.status,
      truncate(node.title, 46),
      node.taskId ?? '-',
      relations || '-',
      node.id,
    ];
  });
  console.log();
  printTable(rows, ['TYPE', 'STATUS', 'TITLE', 'TASK', 'RELATIONS', 'NODE ID']);
}

function printTick(result: GoalTickResult) {
  const icon =
    result.outcome === 'achieved'
      ? pc.green('✓')
      : result.outcome === 'waiting_human'
        ? pc.yellow('◆')
        : result.outcome === 'failed'
          ? pc.red('✗')
          : pc.blue('→');
  console.log(`${icon} ${pc.bold(result.outcome)} ${result.message}`);
  if (result.taskId) console.log(`  ${pc.dim(`task: ${result.taskId}`)}`);
  if (result.nodeId) console.log(`  ${pc.dim(`node: ${result.nodeId}`)}`);
}

export function registerGoalCommand(program: Command) {
  const goal = program.command('goal').description('Run long-horizon Goal Graphs');

  goal
    .command('create <title>')
    .description('Create a standalone goal and seed its graph')
    .option('-r, --requirement <text>', 'Acceptance requirement')
    .option(
      '-i, --instruction <text>',
      "The ask in the user's own words, shown on the problem node",
    )
    .option('-t, --task <title...>', 'Initial task node titles (omit to let the planner decompose)')
    .option('--agent <id>', 'Responsible agent ID')
    .option('--project <id>', 'Project ID')
    .option('--max-rounds <n>', 'Maximum goal rounds')
    .option('--max-cost <usd>', 'Maximum total cost in USD')
    .option('--max-attempts-per-task <n>', 'Attempts per Task before opening a decision gate')
    .option(
      '--max-concurrent-tasks <n>',
      "How many of this goal's tasks may run at once (default 3)",
    )

    .option('--max-steps-per-run <n>', 'Optional agent step cap per Task run (for example 500)')
    .option(
      '--operation-lease-timeout-ms <n>',
      'Reclaim a Task operation after this idle time (minimum: 60000)',
    )
    .option('--json [fields]', 'Output JSON')
    .action(async (title: string, options) => {
      const client = await getTrpcClient();
      const buildUrl = await resolveAppUrlBuilder(client);
      const result = await client.goal.create.mutate({
        agentId: options.agent,
        config:
          options.maxAttemptsPerTask ||
          options.maxStepsPerRun ||
          options.operationLeaseTimeoutMs ||
          options.maxConcurrentTasks
            ? {
                maxConcurrentTasks: options.maxConcurrentTasks
                  ? Number.parseInt(options.maxConcurrentTasks, 10)
                  : undefined,
                recovery: {
                  maxAttemptsPerTask: options.maxAttemptsPerTask
                    ? Number.parseInt(options.maxAttemptsPerTask, 10)
                    : undefined,
                  maxStepsPerRun: options.maxStepsPerRun
                    ? Number.parseInt(options.maxStepsPerRun, 10)
                    : undefined,
                  operationLeaseTimeoutMs: options.operationLeaseTimeoutMs
                    ? Number.parseInt(options.operationLeaseTimeoutMs, 10)
                    : undefined,
                },
              }
            : undefined,
        maxRounds: options.maxRounds ? Number.parseInt(options.maxRounds, 10) : undefined,
        maxTotalCost: options.maxCost ? Number.parseFloat(options.maxCost) : undefined,
        problemDescription: options.instruction,
        projectId: options.project,
        requirement: options.requirement,
        title,
        tasks: options.task,
      });
      // `goal.create` returns the whole graph snapshot, so the id is on its
      // goal — `result.data.id` is undefined, and the CLI cannot resolve the
      // router's types to catch that, which is how it reached a printed URL.
      const url = buildUrl(`/goal/${encodeURIComponent(result.data.goal.id)}`);
      if (options.json !== undefined) return outputJson({ ...result.data, url }, options.json);
      printGraph(result.data);
      console.log(`${pc.bold('goal')}: ${url}`);
    });

  goal
    .command('list')
    .description('List goals with their graph roll-up')
    .option('--agent <id>', 'Filter by responsible agent')
    .option('--project <id>', 'Filter by project')
    .option('--status <status...>', 'Filter by lifecycle status')
    .option('--limit <n>', 'Maximum rows', '50')
    .option('--json [fields]', 'Output JSON')
    .action(async (options) => {
      const result = await (
        await getTrpcClient()
      ).goal.list.query({
        agentId: options.agent,
        limit: Number.parseInt(options.limit, 10),
        projectId: options.project,
        statuses: options.status,
      });
      if (options.json !== undefined) return outputJson(result.goals, options.json);
      if (result.goals.length === 0) return log.info('No goals yet.');
      printTable(
        result.goals.map((item) => [
          item.goal.status,
          truncate(item.goal.title, 44),
          `${item.taskDone}/${item.taskTotal}`,
          String(item.findingCount),
          item.pendingDecisions > 0 ? pc.yellow(String(item.pendingDecisions)) : '-',
          `$${item.totalRunCost.toFixed(2)}`,
          item.goal.id,
        ]),
        ['STATUS', 'TITLE', 'TASKS', 'FINDINGS', 'NEEDS YOU', 'COST', 'GOAL ID'],
      );
    });

  const show = async (id: string, options: { json?: boolean | string }) => {
    const result = await (await getTrpcClient()).goal.graph.query({ id });
    if (options.json !== undefined) return outputJson(result.data, options.json);
    printGraph(result.data);
  };
  goal
    .command('show <id>')
    .description('Show goal and graph')
    .option('--json [fields]', 'Output JSON')
    .action(show);
  goal
    .command('graph <id>')
    .description('Show the Goal Graph')
    .option('--json [fields]', 'Output JSON')
    .action(show);

  goal
    .command('tick <id>')
    .description('Advance exactly one deterministic coordinator step')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options) => {
      const result = await (await getTrpcClient()).goal.tick.mutate({ id });
      if (options.json !== undefined) return outputJson(result.data, options.json);
      printTick(result.data);
    });

  goal
    .command('run <id>')
    .description('Tick until the goal reaches a stop condition')
    .option(
      '--max-ticks <n>',
      'Safety limit on ADVANCING ticks; idle polls of an unchanged waiting state do not count',
      '100',
    )
    .option('--poll-ms <ms>', 'Delay while waiting for task execution', '3000')
    .option(
      '--retry-window-ms <ms>',
      'Keep retrying a failing tick for this long before giving up (0 disables retry)',
      '600000',
    )
    .option('--json', 'Output tick results as JSON')
    .action(
      async (
        id: string,
        options: { json?: boolean; maxTicks: string; pollMs: string; retryWindowMs: string },
      ) => {
        const client = await getTrpcClient();
        const results: GoalRunTickResult[] = [];
        const maxTicks = Number.parseInt(options.maxTicks, 10);
        const pollMs = Number.parseInt(options.pollMs, 10);
        const retryWindowMs = Number.parseInt(options.retryWindowMs, 10);
        // Only ticks that CHANGED something count against the budget. Polling an
        // unchanged `waiting_external` state is the coordinator idling while a
        // Task runs — a Task that legitimately takes an hour would otherwise
        // burn the whole allowance on no-ops and stop a healthy goal half-way.
        let advancingTicks = 0;
        let exhaustedBudget = false;
        for (;;) {
          // Pinned explicitly: inferring `T` through the callback collapses the
          // router's return type to `unknown` in the CLI's standalone
          // type-check, which has no built `@lobechat/types` to resolve against.
          const { data } = await tickWithRetry<{ data: GoalTickResult }>(
            () => client.goal.tick.mutate({ id }),
            retryWindowMs,
            (error, delayMs) => {
              if (options.json) return;
              const message = error instanceof Error ? error.message : String(error);
              log.warn(`Tick failed (${message}); retrying in ${delayMs}ms`);
            },
          );
          const previous = results.at(-1);
          const isIdlePoll = isSameWaitingState(previous, data);
          if (isIdlePoll) {
            previous.pollCount = (previous.pollCount ?? 1) + 1;
            previous.waitedMs = (previous.waitedMs ?? pollMs) + pollMs;
          } else {
            advancingTicks++;
            results.push(
              data.outcome === 'waiting_external'
                ? { ...data, pollCount: 1, waitedMs: pollMs }
                : data,
            );
            if (!options.json) printTick(data);
          }
          if (terminalOutcomes.has(data.outcome)) break;
          if (!isIdlePoll && advancingTicks >= maxTicks) {
            exhaustedBudget = true;
            break;
          }
          if (data.outcome === 'waiting_external') await sleep(pollMs);
        }
        if (options.json) outputJson(results);
        if (exhaustedBudget) {
          // A half-finished goal must not look like success to a wrapper script:
          // the whole reason this branch exists is that the run still has work
          // left, so leave a non-zero code behind for the caller to branch on.
          process.exitCode = 1;
          log.warn(
            `Stopped after ${advancingTicks} advancing ticks (--max-ticks ${maxTicks}); the goal is unfinished. Resume with: lh goal run ${id}`,
          );
        }
      },
    );

  for (const action of ['pause', 'resume'] as const) {
    goal
      .command(`${action} <id>`)
      .description(`${action === 'pause' ? 'Pause' : 'Resume'} goal coordination`)
      .action(async (id: string) => {
        const client = await getTrpcClient();
        const result = await client.goal[action].mutate({ id });
        log.info(result.message);
      });
  }

  goal
    .command('set-budget <id>')
    .description('Update limits; pass "none" to remove a limit')
    .option('--max-rounds <n>')
    .option('--max-cost <usd>')
    .action(async (id: string, options: { maxCost?: string; maxRounds?: string }) => {
      const parseLimit = (value: string | undefined, integer = false) =>
        value === undefined
          ? undefined
          : value === 'none'
            ? null
            : integer
              ? Number.parseInt(value, 10)
              : Number.parseFloat(value);
      const result = await (
        await getTrpcClient()
      ).goal.setBudget.mutate({
        id,
        maxRounds: parseLimit(options.maxRounds, true),
        maxTotalCost: parseLimit(options.maxCost),
      });
      log.info(result.message);
    });

  goal
    .command('decisions <id>')
    .description('List durable decision gates')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options) => {
      const graph = (await (await getTrpcClient()).goal.graph.query({ id })).data;
      if (options.json !== undefined) return outputJson(graph.decisions, options.json);
      printTable(
        graph.decisions.map((decision: GoalGraphDecision) => [
          decision.status,
          truncate(decision.question, 60),
          decision.recommendedOptionId ?? '-',
          decision.id,
        ]),
        ['STATUS', 'QUESTION', 'RECOMMENDED', 'DECISION ID'],
      );
    });

  goal
    .command('decide <id> <decision-id>')
    .description('Resolve a durable decision gate')
    .requiredOption('--option <id>', 'Selected option ID')
    .option('--reason <text>', 'Resolution rationale')
    .action(async (id: string, decisionId: string, options) => {
      const result = await (
        await getTrpcClient()
      ).goal.decide.mutate({
        decisionId,
        id,
        optionId: options.option,
        resolution: options.reason,
      });
      log.info(result.message);
    });

  goal
    .command('add-node <id> <kind> <title>')
    .description('Add a problem, task, finding, or decision node')
    .option('-d, --description <text>')
    .option('-p, --priority <n>')
    .action(
      async (
        id: string,
        kind: 'decision' | 'finding' | 'problem' | 'task',
        title: string,
        options,
      ) => {
        const result = await (
          await getTrpcClient()
        ).goal.addNode.mutate({
          description: options.description,
          id,
          kind,
          priority: options.priority ? Number.parseInt(options.priority, 10) : undefined,
          title,
        });
        log.info(`Created node ${result.data.id}`);
      },
    );

  goal
    .command('add-edge <id> <source> <target> <kind>')
    .description('Connect two Goal Graph nodes')
    .action(async (id: string, sourceNodeId: string, targetNodeId: string, kind) => {
      const result = await (
        await getTrpcClient()
      ).goal.addEdge.mutate({
        id,
        kind,
        sourceNodeId,
        targetNodeId,
      });
      log.info(`Created edge ${result.data.id}`);
    });
}
