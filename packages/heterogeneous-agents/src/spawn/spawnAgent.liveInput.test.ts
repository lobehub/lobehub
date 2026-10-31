import type * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import type * as os from 'node:os';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnAgent } from './spawnAgent';

const spawnCalls: Array<{ args: string[]; command: string }> = [];
let nextFakeProc: any = null;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[]) => {
      spawnCalls.push({ args, command });
      return nextFakeProc;
    }),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

const line = (message: Record<string, unknown>) => `${JSON.stringify(message)}\n`;

const assistantText = (id: string, text: string) =>
  line({
    message: {
      content: [{ text, type: 'text' }],
      id,
      model: 'claude-sonnet-4-6',
      role: 'assistant',
    },
    type: 'assistant',
  });

/** A Claude Code child whose stdout the test drives and whose stdin it reads. */
const createLiveProc = () => {
  const proc = new EventEmitter() as any;
  const stdin = new PassThrough();
  const stdinLines: any[] = [];
  let stdinEnded = false;
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) stdinLines.push(JSON.parse(raw));
  });
  stdin.on('finish', () => {
    stdinEnded = true;
  });
  proc.stdin = stdin;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 4321;

  return {
    emit: (chunk: string) => proc.stdout.write(chunk),
    exit: (code: number) => {
      proc.stdout.end();
      proc.stderr.end();
      proc.emit('exit', code, null);
    },
    proc,
    get stdinEnded() {
      return stdinEnded;
    },
    stdinLines,
  };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

describe('spawnAgent live input (Claude Code)', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  afterEach(() => {
    nextFakeProc = null;
  });

  it('delivers a mid-run message and reports runtime end once, at process exit', async () => {
    const fake = createLiveProc();
    nextFakeProc = fake.proc;

    const handle = await spawnAgent({
      agentType: 'claude-code',
      liveInput: true,
      operationId: 'op-live',
      prompt: 'split the files',
    });
    const events: any[] = [];
    const drained = (async () => {
      for await (const event of handle.events) events.push(event);
    })();

    expect(spawnCalls[0].args).toContain('--replay-user-messages');
    await tick();
    const firstUuid = fake.stdinLines[0].uuid;
    expect(fake.stdinLines[0]).toMatchObject({
      message: { content: [{ text: 'split the files', type: 'text' }] },
      type: 'user',
      uuid: expect.any(String),
    });

    // First turn ends while a background agent is still running.
    fake.emit(
      line({ model: 'claude-sonnet-4-6', session_id: 'cc-1', subtype: 'init', type: 'system' }),
    );
    fake.emit(line({ isReplay: true, message: { content: [] }, type: 'user', uuid: firstUuid }));
    fake.emit(assistantText('msg_1', 'started the agents'));
    fake.emit(
      line({ subtype: 'task_started', task_id: 't-1', tool_use_id: 'tu-1', type: 'system' }),
    );
    fake.emit(line({ is_error: false, result: 'started', subtype: 'success', type: 'result' }));
    await tick();

    expect(fake.stdinEnded).toBe(false);
    expect(events.some((event) => event.type === 'agent_runtime_end')).toBe(false);

    await expect(handle.sendUserMessage!('also open the PRs', { uuid: 'u-2' })).resolves.toBe(true);
    await tick();
    expect(fake.stdinLines[1]).toMatchObject({
      message: { content: [{ text: 'also open the PRs', type: 'text' }] },
      uuid: 'u-2',
    });

    fake.emit(line({ isReplay: true, message: { content: [] }, type: 'user', uuid: 'u-2' }));
    fake.emit(assistantText('msg_2', 'will do'));
    fake.emit(line({ subtype: 'task_notification', task_id: 't-1', type: 'system' }));
    fake.emit(line({ is_error: false, result: 'done', subtype: 'success', type: 'result' }));
    await tick();

    expect(fake.stdinEnded).toBe(true);
    await expect(handle.sendUserMessage!('too late')).resolves.toBe(false);

    fake.exit(0);
    await drained;

    const runtimeEnds = events.filter((event) => event.type === 'agent_runtime_end');
    expect(runtimeEnds).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('agent_runtime_end');
  });

  const runToExit = async (results: Record<string, unknown>[], exitCode: number) => {
    const fake = createLiveProc();
    nextFakeProc = fake.proc;
    const handle = await spawnAgent({
      agentType: 'claude-code',
      liveInput: true,
      operationId: 'op-live',
      prompt: 'task',
    });
    const events: any[] = [];
    const drained = (async () => {
      for await (const event of handle.events) events.push(event);
    })();
    await tick();

    fake.emit(
      line({
        isReplay: true,
        message: { content: [] },
        type: 'user',
        uuid: fake.stdinLines[0].uuid,
      }),
    );
    for (const result of results) fake.emit(line({ type: 'result', ...result }));
    await tick();
    fake.exit(exitCode);
    await drained;
    return events.filter((event) => event.type === 'agent_runtime_end');
  };

  /** Ends stdout on a final record with no trailing newline. */
  const runToExitUnterminated = async (records: Record<string, unknown>[], exitCode: number) => {
    const fake = createLiveProc();
    nextFakeProc = fake.proc;
    const handle = await spawnAgent({
      agentType: 'claude-code',
      liveInput: true,
      operationId: 'op-live',
      prompt: 'task',
    });
    const events: any[] = [];
    const drained = (async () => {
      for await (const event of handle.events) events.push(event);
    })();
    await tick();

    const uuid = fake.stdinLines[0].uuid;
    fake.emit(line({ isReplay: true, message: { content: [] }, type: 'user', uuid }));
    const body = records.map((record) => JSON.stringify(record)).join('\n');
    fake.emit(body);
    await tick();
    fake.exit(exitCode);
    await drained;
    return events;
  };

  it('completes a run whose final result has no trailing newline', async () => {
    const events = await runToExitUnterminated(
      [{ is_error: false, result: 'done', subtype: 'success', type: 'result' }],
      0,
    );

    expect(events.filter((event) => event.type === 'agent_runtime_end')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ reason: 'complete' }) }),
    ]);
  });

  it('does not report completion when an unterminated final result is an error', async () => {
    const events = await runToExitUnterminated(
      [
        { is_error: false, result: 'first', subtype: 'success', type: 'result' },
        { is_error: true, result: 'API Error: 500 boom', subtype: 'success', type: 'result' },
      ],
      0,
    );

    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.some((event) => event.type === 'agent_runtime_end')).toBe(false);
  });

  it('does not report completion when the CLI exits nonzero after a finished turn', async () => {
    await expect(
      runToExit([{ is_error: false, result: 'done', subtype: 'success' }], 1),
    ).resolves.toEqual([]);
  });

  // Print mode exits 1 after an interrupted last turn (observed with Claude Code 2.1.282).
  it.each([0, 1])(
    'ends a run whose last turn was interrupted as interrupted, not complete (exit %i)',
    async (exitCode) => {
      const [end] = await runToExit(
        [
          {
            is_error: true,
            subtype: 'error_during_execution',
            terminal_reason: 'aborted_streaming',
          },
        ],
        exitCode,
      );

      expect(end.data).toMatchObject({
        kind: 'aborted',
        reason: 'interrupted',
        terminalReason: 'aborted_streaming',
      });
    },
  );

  it('does not report a stale interrupt when a later turn crashes before its result', async () => {
    await expect(
      runToExit(
        [
          {
            is_error: true,
            subtype: 'error_during_execution',
            terminal_reason: 'aborted_streaming',
          },
          // A background task's callback opens a new turn, then the CLI dies.
          { model: 'claude-sonnet-4-6', session_id: 'cc-1', subtype: 'init', type: 'system' },
        ],
        1,
      ),
    ).resolves.toEqual([]);
  });

  it('completes when a turn after an interrupt finishes normally', async () => {
    const [end] = await runToExit(
      [
        { is_error: true, subtype: 'error_during_execution', terminal_reason: 'aborted_streaming' },
        { is_error: false, result: 'done', subtype: 'success' },
      ],
      0,
    );

    expect(end.data).toMatchObject({ reason: 'complete' });
  });

  it('groups the summary after a background Bash completes under the tool that started it', async () => {
    const fake = createLiveProc();
    nextFakeProc = fake.proc;
    const handle = await spawnAgent({
      agentType: 'claude-code',
      liveInput: true,
      operationId: 'op-live',
      prompt: 'run it in the background',
    });
    const events: any[] = [];
    const drained = (async () => {
      for await (const event of handle.events) events.push(event);
    })();
    await tick();

    fake.emit(
      line({ model: 'claude-sonnet-4-6', session_id: 'cc-1', subtype: 'init', type: 'system' }),
    );
    fake.emit(
      line({
        message: {
          content: [
            {
              id: 'toolu_bash',
              input: { command: 'sleep 1 && echo done', run_in_background: true },
              name: 'Bash',
              type: 'tool_use',
            },
          ],
          id: 'msg_01',
        },
        type: 'assistant',
      }),
    );
    fake.emit(
      line({ subtype: 'task_started', task_id: 't-1', tool_use_id: 'toolu_bash', type: 'system' }),
    );
    fake.emit(
      line({
        message: {
          content: [{ content: 'started', tool_use_id: 'toolu_bash', type: 'tool_result' }],
        },
        type: 'user',
      }),
    );
    fake.emit(line({ is_error: false, result: 'started', subtype: 'success', type: 'result' }));
    fake.emit(line({ subtype: 'task_notification', task_id: 't-1', type: 'system' }));
    fake.emit(
      line({
        event: { message: { id: 'msg_02', model: 'claude-sonnet-4-6' }, type: 'message_start' },
        type: 'stream_event',
      }),
    );
    await tick();
    fake.exit(0);
    await drained;

    const summary = events.find(
      (event) => event.type === 'stream_start' && event.data?.messageId === 'msg_02',
    );
    expect(summary?.data.externalSignal).toEqual({
      sourceToolCallId: 'toolu_bash',
      sourceToolName: 'Bash',
      type: 'task-completion',
    });
  });

  it('interrupts only the current turn through a control request', async () => {
    const fake = createLiveProc();
    nextFakeProc = fake.proc;

    const handle = await spawnAgent({
      agentType: 'claude-code',
      liveInput: true,
      operationId: 'op-live',
      prompt: 'long task',
    });

    expect(handle.interruptTurn!()).toBe(true);
    await tick();

    expect(fake.stdinLines[1]).toMatchObject({
      request: { subtype: 'interrupt' },
      type: 'control_request',
    });
    expect(fake.proc.kill).not.toHaveBeenCalled();
    fake.exit(0);
  });

  it('leaves non-live runs with one-shot stdin and no live controls', async () => {
    const fake = createLiveProc();
    nextFakeProc = fake.proc;

    const handle = await spawnAgent({
      agentType: 'claude-code',
      operationId: 'op-once',
      prompt: 'once',
    });
    await tick();

    expect(spawnCalls[0].args).not.toContain('--replay-user-messages');
    expect(fake.stdinEnded).toBe(true);
    expect(handle.sendUserMessage).toBeUndefined();
    expect(handle.interruptTurn).toBeUndefined();
    fake.exit(0);
  });
});
