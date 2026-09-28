import { readFile } from 'node:fs/promises';

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
  experiment: '⚗',
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
  answers: 'answered by',
  contains: 'inside',
  contradicts: 'contradicted by',
  decomposes: 'part of',
  depends_on: 'blocks',
  derived_from: 'ancestor of',
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

/**
 * Whether this process runs with a server-minted operation token (device and
 * gateway runs) rather than the user's own login. Operation tokens are refused
 * on ordinary routes, so commands that act for the running conversation pick
 * the operation-authenticated endpoint instead.
 */
const hasOperationToken = () => {
  const injectedJwt = process.env.LOBEHUB_JWT;
  if (!injectedJwt) return false;
  try {
    return (
      JSON.parse(Buffer.from(injectedJwt.split('.')[1], 'base64url').toString()).purpose ===
      'hetero-operation'
    );
  } catch {
    return false;
  }
};

export function registerGoalCommand(program: Command) {
  const goal = program.command('goal').description('Run long-horizon Goal Graphs');
  goal
    .command('plan <id>')
    .description('Atomically submit the current main Agent plan')
    .requiredOption(
      '--file <path>',
      'JSON plan: action tasks/verify/retry/escalate, reason and action fields',
    )
    .requiredOption('--token <token>', 'Current server-issued planning turn token')
    .option('--operation <id>', 'Defaults to LOBEHUB_OPERATION_ID')
    .option('--json', 'Output JSON')
    .action(
      async (
        id: string,
        options: { file: string; token: string; operation?: string; json?: boolean },
      ) => {
        const operationId = options.operation ?? process.env.LOBEHUB_OPERATION_ID;
        if (!operationId) throw new Error('Current manager operation ID required');
        const client = await getTrpcClient();
        const endpoint = hasOperationToken()
          ? client.goal.submitOperationPlan
          : client.goal.submitPlan;
        const result = await endpoint.mutate({
          id,
          token: options.token,
          operationId,
          plan: JSON.parse(await readFile(options.file, 'utf8')),
        });
        if (options.json) outputJson(result.data);
        else
          console.log('Plan recorded; the coordinator will continue after this Agent turn exits.');
      },
    );

  goal
    .command('create <title>')
    .option(
      '--max-manager-turns <n>',
      'Add a main Agent with this turn limit; it takes over problems the system planner cannot route',
    )
    .description('Create a standalone goal and seed its graph')
    .option('-r, --requirement <text>', 'Acceptance requirement')
    .option(
      '-i, --instruction <text>',
      "The ask in the user's own words, shown on the problem node",
    )
    .option('-t, --task <title...>', 'Initial task node titles (omit to let the planner decompose)')
    .option(
      '--agent <id>',
      'Goal agent: supervises and plans the goal (defaults to the current agent)',
    )
    .option(
      '--task-agent <id>',
      "Dedicated executor for the goal's tasks (defaults to the goal agent)",
    )
    .option('--project <id>', 'Project ID')
    .option('--explore <instruction>', 'Explore alternatives using completed experiment results')
    .option('--max-experiments <n>', 'Maximum experiment nodes (requires --explore, default 10)')
    .option('--supervise', 'Enable bounded recovery supervision in an independent topic')
    .option(
      '--max-supervision-incidents <n>',
      'Maximum supervised interruptions (default 10, maximum 100)',
    )
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
    .option(
      '--conversation',
      'Create the goal from the current conversation run (/goal): this agent supervises it from this conversation, and the output carries a turnToken for the first plan',
    )
    .option('--criterion <text...>', 'Acceptance criterion (repeatable)')
    .option('--json [fields]', 'Output JSON')
    .action(async (title: string, options) => {
      if (options.maxExperiments && !options.explore) {
        throw new Error('--max-experiments requires --explore');
      }
      const operationId = process.env.LOBEHUB_OPERATION_ID;
      if (options.conversation && !operationId) {
        throw new Error(
          '--conversation must run inside an agent conversation (LOBEHUB_OPERATION_ID)',
        );
      }
      const client = await getTrpcClient();
      const buildUrl = await resolveAppUrlBuilder(client);
      const goalInput = {
        config:
          options.maxManagerTurns ||
          options.explore ||
          options.supervise ||
          options.maxAttemptsPerTask ||
          options.maxStepsPerRun ||
          options.operationLeaseTimeoutMs ||
          options.maxConcurrentTasks ||
          options.taskAgent
            ? {
                taskAgentId: options.taskAgent,
                manager: options.maxManagerTurns
                  ? { maxTurns: Number(options.maxManagerTurns) }
                  : undefined,
                exploration: options.explore
                  ? {
                      instruction: options.explore,
                      maxExperiments: Number(options.maxExperiments ?? 10),
                    }
                  : undefined,
                supervision: options.supervise
                  ? {
                      enabled: true,
                      maxIncidents: options.maxSupervisionIncidents
                        ? Number.parseInt(options.maxSupervisionIncidents, 10)
                        : undefined,
                    }
                  : undefined,
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
        criteria: (options.criterion as string[] | undefined)?.map((criterion) => ({
          title: criterion,
        })),
        maxRounds: options.maxRounds ? Number.parseInt(options.maxRounds, 10) : undefined,
        maxTotalCost: options.maxCost ? Number.parseFloat(options.maxCost) : undefined,
        problemDescription: options.instruction,
        projectId: options.project,
        requirement: options.requirement,
        title,
        tasks: options.task,
      };
      // A conversation goal takes its agent and conversation from the running
      // operation on the server; the CLI only names the run. Device and gateway
      // runs hold an operation token, which only the operation endpoint accepts.
      // A local desktop run keeps its operation client-side, so it also names
      // its conversation and agent for the server to check.
      const result = options.conversation
        ? hasOperationToken()
          ? await client.goal.createConversationGoal.mutate({
              ...goalInput,
              operationId: operationId!,
            })
          : await client.goal.create.mutate({
              ...goalInput,
              agentId: process.env.LOBEHUB_AGENT_ID,
              conversationOperationId: operationId,
              conversationTopicId: process.env.LOBEHUB_TOPIC_ID,
            })
        : await client.goal.create.mutate({
            ...goalInput,
            agentId: options.agent ?? process.env.LOBEHUB_AGENT_ID,
            createdByAgentId: process.env.LOBEHUB_AGENT_ID,
          });
      const turnToken = 'turnToken' in result ? result.turnToken : undefined;
      // `goal.create` returns the whole graph snapshot, so the id is on its
      // goal — `result.data.id` is undefined, and the CLI cannot resolve the
      // router's types to catch that, which is how it reached a printed URL.
      const url = buildUrl(`/goal/${encodeURIComponent(result.data!.goal.id)}`);
      if (options.json !== undefined)
        return outputJson({ ...result.data, turnToken, url }, options.json);
      printGraph(result.data!);
      console.log(`${pc.bold('goal')}: ${url}`);
      if (turnToken) {
        console.log(
          `${pc.bold('planning turn')}: lh goal plan ${result.data!.goal.id} --token ${turnToken} --file <plan.json>`,
        );
      }
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
    .command('supervision <id>')
    .description('Inspect recovery incidents, diagnostic topic and effective recovery rate')
    .action(async (id: string) => {
      const result = await (await getTrpcClient()).goal.supervision.query({ id });
      outputJson(result.data);
    });

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
    .option('--max-experiments <n>', 'Exploration experiment cap (1–200)')
    .option(
      '--max-manager-turns <n>',
      'Main Agent turn cap (1–100); raising it resumes a goal it paused',
    )
    .option(
      '--max-concurrent-tasks <n>',
      'Tasks allowed to run at once (1–10; "none" restores the default)',
    )
    .option('--max-attempts-per-task <n>', 'Attempts per Task before opening a decision gate')
    .option('--max-steps-per-run <n>', 'Agent step cap per Task run ("none" removes it)')
    .action(
      async (
        id: string,
        options: {
          maxAttemptsPerTask?: string;
          maxConcurrentTasks?: string;
          maxCost?: string;
          maxExperiments?: string;
          maxManagerTurns?: string;
          maxRounds?: string;
          maxStepsPerRun?: string;
        },
      ) => {
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
          maxAttemptsPerTask:
            options.maxAttemptsPerTask === undefined
              ? undefined
              : Number.parseInt(options.maxAttemptsPerTask, 10),
          maxConcurrentTasks: parseLimit(options.maxConcurrentTasks, true),
          maxExperiments:
            options.maxExperiments === undefined ? undefined : Number(options.maxExperiments),
          maxManagerTurns:
            options.maxManagerTurns === undefined
              ? undefined
              : Number.parseInt(options.maxManagerTurns, 10),
          maxRounds: parseLimit(options.maxRounds, true),
          maxStepsPerRun: parseLimit(options.maxStepsPerRun, true),
          maxTotalCost: parseLimit(options.maxCost),
        });
        log.info(result.message);
      },
    );

  goal
    .command('set-agent <id> <agent>')
    .description(
      'Hand the goal to a different supervising agent (its unfinished tasks follow unless the goal has a task agent)',
    )
    .option('--goal-only', 'Only change the goal-level agent; leave existing tasks as assigned')
    .action(async (id: string, agentId: string, options: { goalOnly?: boolean }) => {
      const result = await (
        await getTrpcClient()
      ).goal.setAgent.mutate({ agentId, goalOnly: options.goalOnly, id });
      log.info(result.message);
    });

  goal
    .command('set-task-agent <id> <agent>')
    .description(
      'Route the goal\'s tasks to a dedicated executor; "none" hands them back to the goal agent',
    )
    .option('--goal-only', 'Only change future tasks; leave existing tasks as assigned')
    .action(async (id: string, agent: string, options: { goalOnly?: boolean }) => {
      const result = await (
        await getTrpcClient()
      ).goal.setTaskAgent.mutate({
        agentId: agent === 'none' ? null : agent,
        goalOnly: options.goalOnly,
        id,
      });
      log.info(result.message);
    });

  goal
    .command('restart <id>')
    .description('Start every unfinished task over (cancel stale runs, reset to backlog)')
    .option(
      '--agent <id>',
      "Also hand the restarted tasks (and the goal's executor slot) to this agent",
    )
    .action(async (id: string, options: { agent?: string }) => {
      const result = await (
        await getTrpcClient()
      ).goal.restart.mutate({ agentId: options.agent, id });
      log.info(`${result.message}. Resume ticking with: lh goal run ${id}`);
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
    .description('Add a question, experiment container, task, finding, or decision node')
    .option('--scope <experiment-id>', 'Contain this node in an experiment')
    .option('--question <node-id>', 'Question this experiment answers')
    .option('-d, --description <text>')
    .option('-p, --priority <n>')
    .action(
      async (
        id: string,
        kind: 'decision' | 'experiment' | 'finding' | 'problem' | 'task',
        title: string,
        options,
      ) => {
        const result = await (
          await getTrpcClient()
        ).goal.addNode.mutate({
          description: options.description,
          scopeId: options.scope,
          questionId: options.question,
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
