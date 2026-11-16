import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import {
  registerGoalObjectiveCommands,
  runEvaluator,
  splitEvaluatorCommand,
  withMachineLock,
} from './objective';

const { mockClient, operationToken } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      objective: { query: vi.fn() },
      objectiveOperation: { query: vi.fn() },
      recordEvaluation: { mutate: vi.fn() },
      recordEvaluationOperation: { mutate: vi.fn() },
      setObjective: { mutate: vi.fn() },
    },
  },
  operationToken: { value: false },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
vi.mock('./reads', () => ({ hasOperationToken: () => operationToken.value }));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalObjectiveCommands(program.command('goal'));
  return program.parseAsync(['node', 'test', 'goal', ...args]);
};

const board = (evaluator: string) => ({
  best: undefined,
  lanes: [],
  objective: { direction: 'max', evaluator },
});

describe('lh goal objective commands', () => {
  let cwd: string;
  let output: string[];

  beforeEach(async () => {
    vi.clearAllMocks();
    operationToken.value = false;
    output = [];
    vi.spyOn(log, 'info').mockImplementation((message: string) => void output.push(message));
    vi.spyOn(console, 'log').mockImplementation(
      (message?: unknown) => void output.push(String(message)),
    );
    cwd = await mkdtemp(path.join(tmpdir(), 'lh-objective-'));
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('sets an objective with its evaluator and direction', async () => {
    mockClient.goal.setObjective.mutate.mockResolvedValue({ message: 'Objective set' });

    await run(
      'set-objective',
      'goal_1',
      '--evaluator',
      './score.sh',
      '--direction',
      'min',
      '--timeout',
      '600',
    );

    expect(mockClient.goal.setObjective.mutate).toHaveBeenCalledWith({
      id: 'goal_1',
      objective: {
        direction: 'min',
        evaluator: './score.sh',
        key: undefined,
        timeoutSeconds: 600,
        title: undefined,
      },
    });
  });

  it('refuses set-objective without an evaluator or --clear', async () => {
    await expect(run('set-objective', 'goal_1')).rejects.toThrow(/--evaluator/);
  });

  it('runs the evaluator in a Goal Task run and records the score for its lane', async () => {
    operationToken.value = true;
    await writeFile(
      path.join(cwd, 'score.sh'),
      'echo "training"; echo \'{"score": 41.5, "summary": "ok", "metrics": {"M1": 0.8}}\'\n',
    );
    mockClient.goal.objectiveOperation.query.mockResolvedValue({ data: board('sh score.sh') });
    mockClient.goal.recordEvaluationOperation.mutate.mockResolvedValue({
      data: {
        lane: 'lane_a',
        leaderboard: {
          lanes: [{ best: 41.5, evaluations: 1, lane: 'lane_a', latest: 41.5, title: 'Lane A' }],
          objective: { direction: 'max', evaluator: 'sh score.sh' },
        },
        newBest: true,
        recorded: true,
      },
    });

    await run('evaluate');

    expect(mockClient.goal.recordEvaluationOperation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ metrics: { M1: 0.8 }, score: 41.5, summary: 'ok', valid: true }),
    );
    expect(output.join('\n')).toContain('Score:   41.5');
    expect(output.join('\n')).toContain('Lane A (your lane)');
    expect(process.exitCode).toBeUndefined();
  });

  it('records nothing and fails when the evaluator prints no score', async () => {
    operationToken.value = true;
    mockClient.goal.objectiveOperation.query.mockResolvedValue({
      // No shell any more: the exit code has to come from the program itself.
      data: board(`node -e "console.log('boom'); process.exit(3)"`),
    });

    await run('evaluate');

    expect(mockClient.goal.recordEvaluationOperation.mutate).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('Evaluator printed no score (exit code 3)');
    expect(process.exitCode).toBe(1);
  });

  it('needs the goal id outside a Goal Task run', async () => {
    await expect(run('evaluate')).rejects.toThrow(/goal id/);
    await expect(run('objective')).rejects.toThrow(/goal id/);
  });
});

describe('withMachineLock', () => {
  it('runs one holder at a time and frees the lock after a failure', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'lh-lock-')), 'lock');
    const order: string[] = [];
    let release!: () => void;
    const first = withMachineLock(
      60,
      () => {
        order.push('first:start');
        return new Promise<void>((resolve) => (release = resolve)).then(() =>
          order.push('first:end'),
        );
      },
      { dir },
    );
    await vi.waitFor(() => expect(order).toEqual(['first:start']));
    const waited = vi.fn();
    const second = withMachineLock(60, async () => void order.push('second'), {
      dir,
      onWait: waited,
    });
    await vi.waitFor(() => expect(waited).toHaveBeenCalled());
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);

    await expect(
      withMachineLock(
        60,
        async () => {
          throw new Error('x');
        },
        { dir },
      ),
    ).rejects.toThrow('x');
    await expect(withMachineLock(60, async () => 'free', { dir })).resolves.toBe('free');
  });
});

describe('withMachineLock ownership', () => {
  const makeDir = async () => path.join(await mkdtemp(path.join(tmpdir(), 'lh-lock-')), 'lock');

  it('does not expire a live holder on the waiter’s shorter timeout', async () => {
    const dir = await makeDir();
    const order: string[] = [];
    let release!: () => void;
    const holder = withMachineLock(
      1800,
      () => new Promise<void>((resolve) => (release = resolve)).then(() => order.push('holder')),
      { dir },
    );
    await vi.waitFor(async () =>
      expect(await readFile(path.join(dir, 'owner'), 'utf8')).toBeTruthy(),
    );

    // A waiter that gives up after one second must still leave the 30-minute evaluation alone.
    const waiter = withMachineLock(1, async () => void order.push('waiter'), { dir, pollMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(order).toEqual([]);

    release();
    await Promise.all([holder, waiter]);
    expect(order).toEqual(['holder', 'waiter']);
  });

  it('takes over a lock whose holder deadline has passed', async () => {
    const dir = await makeDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'pid'), String(process.pid));
    await writeFile(path.join(dir, 'owner'), 'someone-else');
    await writeFile(path.join(dir, 'deadline'), String(Date.now() - 1000));

    await expect(withMachineLock(60, async () => 'taken', { dir, pollMs: 20 })).resolves.toBe(
      'taken',
    );
  });

  it('leaves a replacement lock alone when the previous holder finishes', async () => {
    const dir = await makeDir();
    let release!: () => void;
    const first = withMachineLock(60, () => new Promise<void>((resolve) => (release = resolve)), {
      dir,
    });
    await vi.waitFor(async () =>
      expect(await readFile(path.join(dir, 'owner'), 'utf8')).toBeTruthy(),
    );
    // Simulate a takeover: someone else now owns the directory.
    await writeFile(path.join(dir, 'owner'), 'someone-else');
    release();
    await first;
    expect(await readFile(path.join(dir, 'owner'), 'utf8')).toBe('someone-else');
    await rm(dir, { force: true, recursive: true });
  });
});

describe('runEvaluator', () => {
  const makeCwd = async () => mkdtemp(path.join(tmpdir(), 'lh-eval-'));

  it('splits quoted arguments without a shell', () => {
    expect(splitEvaluatorCommand(`node eval.js --label "a b" 'c d'`)).toEqual([
      'node',
      'eval.js',
      '--label',
      'a b',
      'c d',
    ]);
    // Metacharacters stay literal; nothing is interpreted.
    expect(splitEvaluatorCommand('node x.js; rm -rf /')).toEqual([
      'node',
      'x.js;',
      'rm',
      '-rf',
      '/',
    ]);
    expect(() => splitEvaluatorCommand(`node "unbalanced`)).toThrow(/Unbalanced/);
  });

  it('runs a command and collects its output', async () => {
    const cwd = await makeCwd();
    const result = await runEvaluator(`node -e "console.log(0.75)"`, cwd, 20);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.output.trim()).toBe('0.75');
  });

  it('settles on timeout instead of waiting for inherited pipes', async () => {
    const cwd = await makeCwd();
    const started = Date.now();
    // The child leaves a grandchild holding the pipes; the promise must still settle at the timeout.
    const result = await runEvaluator(
      `node -e "const {spawn}=require('node:child_process');spawn('sleep',['30'],{stdio:'inherit'});setInterval(()=>{},1000)"`,
      cwd,
      0.4,
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
