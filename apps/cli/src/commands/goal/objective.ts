import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type EvaluatorResult, parseEvaluatorOutput } from '@lobechat/utils/goalObjective';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';
import { hasOperationToken } from './reads';

const DEFAULT_TIMEOUT_SECONDS = 1800;
const OUTPUT_TAIL_LINES = 60;
const LOCK_POLL_MS = 2000;

interface Lane {
  best: number;
  evaluations: number;
  lane: string;
  latest: number;
  title: string;
}

interface Leaderboard {
  best?: number;
  lanes: Lane[];
  leader?: string;
  objective: {
    direction: 'max' | 'min';
    evaluator: string;
    timeoutSeconds?: number;
    title?: string;
  };
  you?: string;
}

const formatScore = (value: number) => String(Number(value.toFixed(4)));

export const printLeaderboard = (board: Leaderboard) => {
  const { direction, evaluator, title } = board.objective;
  console.log(
    `${pc.bold(title || 'Objective')} — ${direction === 'max' ? 'higher' : 'lower'} is better · evaluator: ${pc.dim(evaluator)}`,
  );
  if (board.lanes.length === 0) return console.log(pc.dim('  No evaluation recorded yet.'));
  board.lanes.forEach((lane, index) => {
    const you = lane.lane === board.you ? pc.cyan(' (your lane)') : '';
    console.log(
      `  ${index + 1}. ${lane.title}${you}  best ${pc.bold(formatScore(lane.best))} · latest ${formatScore(lane.latest)} · ${lane.evaluations} eval(s)`,
    );
  });
};

/** Outside a Goal Task run there is no run to stand for, so the goal must be named. */
const requireGoalId = (goalId: string | undefined, command: string) => {
  if (!goalId)
    throw new Error(
      `Pass the goal id: \`lh goal ${command}\` outside a Goal Task run cannot tell which goal you mean.`,
    );
  return goalId;
};

const readLeaderboard = async (goalId?: string): Promise<Leaderboard | null> => {
  const client = await getTrpcClient();
  return hasOperationToken()
    ? (await client.goal.objectiveOperation.query()).data
    : (await client.goal.objective.query({ id: requireGoalId(goalId, 'objective <goal-id>') }))
        .data;
};

/**
 * One evaluation at a time per machine: evaluators are often heavy (a judge
 * that trains or replays a model), and lanes of one goal on the same host
 * would otherwise starve each other. A directory is the lock because `mkdir`
 * is atomic everywhere; a holder that died is detected by its pid or age.
 */
export const withMachineLock = async <T>(
  timeoutSeconds: number,
  run: () => Promise<T>,
  { dir = path.join(tmpdir(), 'lobehub-goal-evaluate.lock'), onWait = () => {} } = {},
): Promise<T> => {
  let waited = false;
  for (;;) {
    try {
      await mkdir(dir);
      await writeFile(path.join(dir, 'pid'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number(await readFile(path.join(dir, 'pid'), 'utf8').catch(() => '0'));
      const age = Date.now() - (await stat(dir).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      const alive =
        holder > 0 &&
        (() => {
          try {
            process.kill(holder, 0);
            return true;
          } catch {
            return false;
          }
        })();
      if (!alive || age > (timeoutSeconds + 300) * 1000) {
        await rm(dir, { force: true, recursive: true });
        continue;
      }
      if (!waited) onWait();
      waited = true;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  try {
    return await run();
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

/** Hash of the working tree's committed state plus its uncommitted changes, in a git repo. */
export const workingTreeFingerprint = (cwd: string): string | undefined => {
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const head = git('rev-parse', 'HEAD');
  if (head.status !== 0) return undefined;
  const diff = git('diff', 'HEAD');
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z');
  return createHash('sha256')
    .update(head.stdout)
    .update(diff.stdout ?? '')
    .update(untracked.stdout ?? '')
    .digest('hex')
    .slice(0, 16);
};

/** Run the evaluator in `cwd`; resolves with its combined output and whether it timed out. */
export const runEvaluator = (command: string, cwd: string, timeoutSeconds: number) =>
  new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutSeconds * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });

const tail = (text: string, lines: number) => text.trimEnd().split('\n').slice(-lines).join('\n');

const printResult = (result: EvaluatorResult) => {
  console.log('========================================');
  if (!result.valid) console.log(`  Valid:   ${pc.yellow('no (this evaluation does not count)')}`);
  console.log(`  Score:   ${pc.bold(formatScore(result.score))}`);
  if (result.summary) console.log(`  Summary: ${result.summary}`);
  if (result.metrics) {
    console.log('  Metrics:');
    for (const [key, value] of Object.entries(result.metrics)) console.log(`    ${key}: ${value}`);
  }
  console.log('========================================');
};

/**
 * Objectives: the score a goal optimises and the command that measures it.
 *
 * Inside a Goal Task run (an operation token) `evaluate` and `objective` act
 * for that run's goal and lane. With a person's login they take the goal id,
 * and an evaluation is recorded in the `manual` lane.
 */
export function registerGoalObjectiveCommands(goal: Command) {
  goal
    .command('set-objective <goal-id>')
    .description('Set the score this goal optimises and the command that measures it')
    .option(
      '--evaluator <command>',
      'Shell command that prints the score, run in the working directory',
    )
    .option('--direction <max|min>', 'Whether higher or lower is better', 'max')
    .option('--key <key>', 'Metric series key (default: objective)')
    .option('--title <title>', 'Name of the score')
    .option('--timeout <seconds>', 'Seconds before an evaluation is abandoned')
    .option('--clear', 'Remove the objective')
    .action(
      async (
        goalId: string,
        options: {
          clear?: boolean;
          direction: string;
          evaluator?: string;
          key?: string;
          timeout?: string;
          title?: string;
        },
      ) => {
        if (!options.clear && !options.evaluator)
          throw new Error('Pass --evaluator <command>, or --clear to remove the objective.');
        if (options.direction !== 'max' && options.direction !== 'min')
          throw new Error('--direction must be max or min');
        const result = await (
          await getTrpcClient()
        ).goal.setObjective.mutate({
          id: goalId,
          objective: options.clear
            ? null
            : {
                direction: options.direction,
                evaluator: options.evaluator!,
                key: options.key,
                timeoutSeconds: options.timeout ? Number.parseInt(options.timeout, 10) : undefined,
                title: options.title,
              },
        });
        log.info(result.message);
      },
    );

  goal
    .command('objective [goal-id]')
    .description("Show a goal's objective and the leaderboard of its lanes")
    .option('--json', 'Output JSON')
    .action(async (goalId: string | undefined, options: { json?: boolean }) => {
      const board = await readLeaderboard(goalId);
      if (options.json) return outputJson(board);
      if (!board) return log.info('This goal has no objective.');
      printLeaderboard(board);
    });

  goal
    .command('evaluate')
    .description(
      "Run the goal's evaluator in the current directory, record the score for your lane, and print it",
    )
    .option('-d, --details', 'Also print the tail of the evaluator output')
    .option('--goal <id>', 'The goal, when not run from inside one of its Task runs')
    .option('--timeout <seconds>', "Override the objective's evaluation timeout")
    .action(async (options: { details?: boolean; goal?: string; timeout?: string }) => {
      const board = await readLeaderboard(options.goal);
      if (!board)
        throw new Error('This goal has no objective; set one with `lh goal set-objective`.');
      const timeoutSeconds = options.timeout
        ? Number.parseInt(options.timeout, 10)
        : (board.objective.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
      const cwd = process.cwd();
      const started = Date.now();
      const run = await withMachineLock(
        timeoutSeconds,
        () => runEvaluator(board.objective.evaluator, cwd, timeoutSeconds),
        { onWait: () => log.info('Waiting for another evaluation on this machine to finish...') },
      );
      const durationMs = Date.now() - started;
      const result = run.timedOut ? undefined : parseEvaluatorOutput(run.output);
      if (!result) {
        console.log(
          run.timedOut
            ? `Evaluator timed out after ${timeoutSeconds}s.`
            : `Evaluator printed no score (exit code ${run.code}).`,
        );
        console.log(tail(run.output, OUTPUT_TAIL_LINES));
        process.exitCode = 1;
        return;
      }
      printResult(result);
      if (options.details) console.log(pc.dim(tail(run.output, OUTPUT_TAIL_LINES)));

      const input = {
        durationMs,
        fingerprint: workingTreeFingerprint(cwd),
        metrics: result.metrics,
        score: result.score,
        summary: result.summary,
        valid: result.valid,
      };
      const client = await getTrpcClient();
      const recorded = hasOperationToken()
        ? (await client.goal.recordEvaluationOperation.mutate(input)).data
        : (await client.goal.recordEvaluation.mutate({ ...input, id: options.goal! })).data;
      if (recorded.recorded) {
        if (recorded.newBest) log.info(pc.green('New best score for this goal.'));
        else if (recorded.newLaneBest) log.info(pc.green('New best score for your lane.'));
      }
      if (recorded.leaderboard) printLeaderboard({ ...recorded.leaderboard, you: recorded.lane });
    });
}
