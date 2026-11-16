import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
/** Only for locks written before a holder's deadline was recorded next to its pid. */
const LOCK_STALE_GRACE_MS = 300;

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
  {
    dir = path.join(tmpdir(), 'lobehub-goal-evaluate.lock'),
    onWait = () => {},
    pollMs = LOCK_POLL_MS,
  } = {},
): Promise<T> => {
  // Who holds the lock is recorded, so a waiter that took over an expired lock cannot be evicted
  // by the previous holder's `finally`.
  const owner = `${process.pid}-${Date.now().toString(36)}`;
  const staged = `${dir}.staging-${owner}`;
  let waited = false;
  for (;;) {
    // Built off to the side and renamed into place: a lock directory that exists always carries
    // its owner files, so a waiter never reads a half-written lock as a dead one.
    await mkdir(staged, { recursive: true });
    await writeFile(path.join(staged, 'pid'), String(process.pid));
    await writeFile(path.join(staged, 'owner'), owner);
    // The holder's own deadline, not the waiter's timeout, decides when the lock may be taken.
    await writeFile(path.join(staged, 'deadline'), String(Date.now() + timeoutSeconds * 1000));
    try {
      await rename(staged, dir);
      break;
    } catch (error) {
      await rm(staged, { force: true, recursive: true });
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'ENOTDIR') throw error;

      const holder = Number(await readFile(path.join(dir, 'pid'), 'utf8').catch(() => '0'));
      const deadline = Number(await readFile(path.join(dir, 'deadline'), 'utf8').catch(() => '0'));
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
      // A live holder keeps the lock for as long as it said it would, whatever this waiter's own
      // timeout is. Locks written before `deadline` existed fall back to pid plus age.
      const expired = deadline > 0 ? Date.now() > deadline : age > LOCK_STALE_GRACE_MS * 1000;
      if (!alive || expired) {
        await rm(dir, { force: true, recursive: true });
        continue;
      }
      if (!waited) onWait();
      waited = true;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  try {
    return await run();
  } finally {
    const current = await readFile(path.join(dir, 'owner'), 'utf8').catch(() => '');
    if (current === owner) await rm(dir, { force: true, recursive: true });
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

/**
 * Splits an evaluator command into an executable and its arguments.
 *
 * The evaluator string is stored on the goal and read back from the server, so other lane members
 * can write it. It is never handed to a shell: metacharacters stay literal, and only quoting (so
 * one argument can contain a space) keeps its meaning.
 */
export const splitEvaluatorCommand = (command: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quoted: '"' | "'" | undefined;
  let started = false;
  for (const char of command) {
    if (quoted) {
      if (char === quoted) quoted = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quoted = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (quoted) throw new Error(`Unbalanced ${quoted} in the evaluator command: ${command}`);
  if (started) tokens.push(current);

  return tokens;
};

/** Kills the evaluator and everything it started, not just the process we spawned. */
const killEvaluatorTree = (child: { kill: (signal: NodeJS.Signals) => boolean; pid?: number }) => {
  const { pid } = child;
  if (pid && process.platform !== 'win32') {
    try {
      // `detached` below makes the child its own process group leader, so the group id is its pid.
      process.kill(-pid, 'SIGKILL');
      return;
    } catch {
      // Fall through to the plain kill below.
    }
  }
  if (pid && process.platform === 'win32') {
    const killed = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
    if (killed.status === 0) return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already gone.
  }
};

/**
 * Run the evaluator in `cwd`; resolves with its combined output and whether it timed out.
 *
 * The timeout settles on its own: a helper that inherited stdout/stderr can keep the pipes open
 * long after the evaluator is gone, and waiting for `close` would hold the machine lock past the
 * deadline the user asked for.
 */
export const runEvaluator = (command: string, cwd: string, timeoutSeconds: number) =>
  new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve) => {
    const [executable, ...args] = splitEvaluatorCommand(command);
    if (!executable) {
      resolve({ code: null, output: '', timedOut: false });
      return;
    }
    const child = spawn(executable, args, {
      cwd,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code, output, timedOut });
    };
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      killEvaluatorTree(child);
      finish(null);
    }, timeoutSeconds * 1000);
    child.on('error', (error) => {
      output += `${error.message}\n`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
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
      'Command that prints the score, run in the working directory (no shell; quote arguments with spaces)',
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
