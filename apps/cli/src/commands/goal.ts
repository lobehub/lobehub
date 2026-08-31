import type {
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
const terminalOutcomes = new Set(['achieved', 'waiting_human', 'no_progress', 'failed']);

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
    const dependencies = (incoming.get(node.id) ?? [])
      .map((edge) => `${edge.kind}:${edge.sourceNodeId.slice(0, 8)}`)
      .join(', ');
    return [
      `${nodeIcon[node.kind]} ${node.kind}`,
      node.status,
      truncate(node.title, 46),
      node.taskId ?? '-',
      dependencies || '-',
      node.id,
    ];
  });
  console.log();
  printTable(rows, ['TYPE', 'STATUS', 'TITLE', 'TASK', 'INCOMING', 'NODE ID']);
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
    .option('-w, --work <title...>', 'Initial work node titles')
    .option('--agent <id>', 'Responsible agent ID')
    .option('--project <id>', 'Project ID')
    .option('--max-rounds <n>', 'Maximum goal rounds')
    .option('--max-cost <usd>', 'Maximum total cost in USD')
    .option('--max-attempts-per-work <n>', 'Attempts per Work before opening a decision gate')
    .option('--max-steps-per-run <n>', 'Optional agent step cap per Work run (for example 500)')
    .option(
      '--operation-lease-timeout-ms <n>',
      'Reclaim a Work operation after this idle time (minimum: 60000)',
    )
    .option('--json [fields]', 'Output JSON')
    .action(async (title: string, options) => {
      const client = await getTrpcClient();
      const buildUrl = await resolveAppUrlBuilder(client);
      const result = await client.goal.create.mutate({
        agentId: options.agent,
        config:
          options.maxAttemptsPerTask || options.maxStepsPerRun || options.operationLeaseTimeoutMs
            ? {
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
        projectId: options.project,
        requirement: options.requirement,
        title,
        work: options.work,
      });
      const url = buildUrl(`/goal/${encodeURIComponent(result.data.id)}`);
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
          `${item.workDone}/${item.workTotal}`,
          String(item.findingCount),
          item.pendingDecisions > 0 ? pc.yellow(String(item.pendingDecisions)) : '-',
          `$${item.totalRunCost.toFixed(2)}`,
          item.goal.id,
        ]),
        ['STATUS', 'TITLE', 'WORK', 'FINDINGS', 'NEEDS YOU', 'COST', 'GOAL ID'],
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
    .option('--max-ticks <n>', 'Safety limit for this CLI invocation', '100')
    .option('--poll-ms <ms>', 'Delay while waiting for task execution', '3000')
    .option('--json', 'Output tick results as JSON')
    .action(async (id: string, options: { json?: boolean; maxTicks: string; pollMs: string }) => {
      const client = await getTrpcClient();
      const results: GoalRunTickResult[] = [];
      const maxTicks = Number.parseInt(options.maxTicks, 10);
      const pollMs = Number.parseInt(options.pollMs, 10);
      for (let index = 0; index < maxTicks; index++) {
        const { data } = await client.goal.tick.mutate({ id });
        const previous = results.at(-1);
        if (isSameWaitingState(previous, data)) {
          previous.pollCount = (previous.pollCount ?? 1) + 1;
          previous.waitedMs = (previous.waitedMs ?? pollMs) + pollMs;
        } else {
          results.push(
            data.outcome === 'waiting_external'
              ? { ...data, pollCount: 1, waitedMs: pollMs }
              : data,
          );
          if (!options.json) printTick(data);
        }
        if (terminalOutcomes.has(data.outcome)) break;
        if (data.outcome === 'waiting_external') {
          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
      }
      if (options.json) outputJson(results);
      const last = results.at(-1);
      if (last && !terminalOutcomes.has(last.outcome)) {
        log.warn(`Stopped after ${maxTicks} ticks; rerun to continue.`);
      }
    });

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
    .description('Add a problem, work, finding, or decision node')
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
