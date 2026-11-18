import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeCodeDriver } from '../modules/heterogeneousAgent/drivers/claudeCode';
import HeterogeneousAgentCtr from './HeterogeneousAgentImpl';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: vi.fn(() => '/fake/appPath'),
    getPath: vi.fn((name: string) => `/fake/${name}`),
    getVersion: vi.fn(() => '1.0.0-test'),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

const line = (message: Record<string, unknown>) => `${JSON.stringify(message)}\n`;

/**
 * A local Claude Code CLI run in Queue mode, or with the Better Coding
 * Experience lab off: nothing is steered into it. Its stdin must still
 * stay open, as under `lh hetero exec`.
 */
const startQueueModeRun = async () => {
  const ctr = new HeterogeneousAgentCtr({
    appStoragePath: '/fake/storage',
    storeManager: { get: vi.fn() },
  } as any);
  const broadcasts: Array<{ channel: string; data: any }> = [];
  vi.spyOn(ctr as any, 'broadcast').mockImplementation((channel: any, data: any) => {
    broadcasts.push({ channel, data });
  });
  vi.spyOn(ctr as any, 'recordInflightRun').mockImplementation(() => {});

  const session: any = { agentType: 'claude-code', args: [], command: 'claude', sessionId: 's1' };
  (ctr as any).sessions.set('s1', session);

  const spawnPlan = await claudeCodeDriver.buildSpawnPlan({
    args: [],
    helpers: {
      buildAgentInput: async () => ({ args: [], stdin: line({ message: {}, type: 'user' }) }),
    },
    promptInput: 'run the long build in the background',
  });

  const stdin = new PassThrough();
  const written: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) written.push(JSON.parse(raw));
  });
  const stdinEnded = vi.fn();
  stdin.on('finish', stdinEnded);

  const proc: any = new EventEmitter();
  proc.stdin = stdin;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.spawnargs = ['claude', ...spawnPlan.args];
  proc.spawnfile = 'claude';

  let settled: 'rejected' | 'resolved' | undefined;
  (ctr as any).handleSpawnedAgentProcess({
    cwd: '/tmp',
    params: { operationId: 'op-1', prompt: 'p', sessionId: 's1' },
    proc,
    reject: () => (settled = 'rejected'),
    resolve: () => (settled = 'resolved'),
    session,
    spawnEnv: {},
    spawnPlan,
    traceSession: undefined,
    useStdin: true,
  });

  const emit = (message: Record<string, unknown>) => proc.stdout.write(line(message));
  /** Claude Code reads the prompt: replays it under the uuid it was written with. */
  const readPrompt = async () => {
    await vi.waitFor(() => expect(written).toHaveLength(1));
    emit({ session_id: 'cc-1', subtype: 'init', type: 'system' });
    emit({ isReplay: true, message: {}, type: 'user', uuid: written[0].uuid });
  };
  const result = () =>
    emit({
      is_error: false,
      result: 'done',
      subtype: 'success',
      terminal_reason: 'completed',
      type: 'result',
    });
  const exit = async (code: number) => {
    proc.stdout.end();
    proc.stderr.end();
    proc.emit('exit', code, null);
    await vi.waitFor(() => expect(settled).toBeDefined(), { timeout: 3000 });
  };
  const events = () =>
    broadcasts.filter((b) => b.channel === 'heteroAgentEvent').map((b) => b.data.event);

  return {
    broadcasts,
    ctr,
    emit,
    events,
    exit,
    readPrompt,
    result,
    session,
    settled: () => settled,
    spawnPlan,
    stdinEnded,
    written,
  };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('local Claude Code CLI input outside Steer mode', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps stdin open after the prompt and replays what it reads', async () => {
    const run = await startQueueModeRun();

    expect(run.spawnPlan.args).toContain('--replay-user-messages');
    await vi.waitFor(() => expect(run.written).toHaveLength(1));
    await tick();
    expect(run.stdinEnded).not.toHaveBeenCalled();
    expect(run.session.liveInput?.isOpen).toBe(true);
  });

  it('ends a run without background tasks as soon as its turn finishes', async () => {
    const run = await startQueueModeRun();
    await run.readPrompt();
    run.result();

    await vi.waitFor(() => expect(run.stdinEnded).toHaveBeenCalled());
    await run.exit(0);

    expect(run.settled()).toBe('resolved');
    expect(run.events().filter((e) => e.type === 'agent_runtime_end')).toHaveLength(1);
    expect(run.broadcasts.some((b) => b.channel === 'heteroAgentSessionComplete')).toBe(true);
  });

  it('stays open while a background task runs, stops it, then ends the run', async () => {
    const run = await startQueueModeRun();
    await run.readPrompt();
    run.emit({
      is_backgrounded: true,
      subtype: 'task_started',
      task_id: 'bash-1',
      task_type: 'local_bash',
      tool_use_id: 'tool-1',
      type: 'system',
    });
    run.result();
    await tick();
    expect(run.stdinEnded).not.toHaveBeenCalled();

    const stopping = run.ctr.stopBackgroundTask({ sessionId: 's1', taskId: 'bash-1' });
    await vi.waitFor(() => expect(run.written).toHaveLength(2));
    expect(run.written[1]).toMatchObject({
      request: { subtype: 'stop_task', task_id: 'bash-1' },
      type: 'control_request',
    });
    run.emit({
      response: { request_id: run.written[1].request_id, response: {}, subtype: 'success' },
      type: 'control_response',
    });
    await expect(stopping).resolves.toBeUndefined();
    expect(run.stdinEnded).not.toHaveBeenCalled();

    // Claude Code wakes no turn for a stopped task: input closes right away.
    run.emit({
      status: 'stopped',
      subtype: 'task_notification',
      task_id: 'bash-1',
      type: 'system',
    });
    await vi.waitFor(() => expect(run.stdinEnded).toHaveBeenCalled());
    await run.exit(0);

    expect(run.settled()).toBe('resolved');
    expect(run.events().filter((e) => e.type === 'agent_runtime_end')).toHaveLength(1);
  });

  it('closes the open input when the run is cancelled', async () => {
    const run = await startQueueModeRun();
    await run.readPrompt();
    const proc = run.session.process;
    proc.kill = vi.fn();
    vi.spyOn(run.ctr as any, 'killProcessTree').mockImplementation(() => {
      setImmediate(() => proc.emit('exit', null, 'SIGINT'));
    });
    vi.spyOn(run.ctr as any, 'waitForProcessExit').mockResolvedValue(true);

    await run.ctr.cancelSession({ sessionId: 's1' });

    await vi.waitFor(() => expect(run.stdinEnded).toHaveBeenCalled());
  });
});
