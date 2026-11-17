import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeLiveInput, resolveClaudeCodeLiveRuntimeEnd } from './claudeCodeLiveInput';

const userLine = (text: string) =>
  `${JSON.stringify({ message: { content: [{ text, type: 'text' }], role: 'user' }, type: 'user' })}\n`;

const line = (message: Record<string, unknown>) => `${JSON.stringify(message)}\n`;

const setup = (options?: { idleCloseMs?: number }) => {
  const stdin = new PassThrough();
  const written: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) written.push(JSON.parse(raw));
  });
  const ended = vi.fn();
  stdin.on('finish', ended);
  const live = new ClaudeCodeLiveInput(stdin, options);
  return { ended, live, written };
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ClaudeCodeLiveInput', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps each delivered message with the uuid it is replayed under', async () => {
    const { live, written } = setup();

    expect(live.send(userLine('first'), 'u-1')).toBe(true);
    await flush();

    expect(written).toEqual([
      {
        message: { content: [{ text: 'first', type: 'text' }], role: 'user' },
        type: 'user',
        uuid: 'u-1',
      },
    ]);
  });

  it('closes stdin at the first result when nothing else can still take input', async () => {
    const { ended, live } = setup();
    live.send(userLine('first'), 'u-1');

    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ type: 'assistant' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    await flush();

    expect(live.isOpen).toBe(false);
    expect(live.lastTurn).toEqual({ aborted: false, terminalReason: undefined });
    expect(ended).toHaveBeenCalled();
  });

  it('keeps stdin open past the result while a background task runs, until the turn its end wakes', () => {
    const { live } = setup();
    live.send(userLine('first'), 'u-1');

    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    expect(live.isOpen).toBe(true);

    live.observe(line({ subtype: 'task_notification', task_id: 't-1', type: 'system' }));
    expect(live.isOpen).toBe(true);

    live.observe(line({ subtype: 'init', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    expect(live.isOpen).toBe(false);
  });

  it('keeps stdin open for a task the wake-up turn starts or resumes', () => {
    const { live } = setup();
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 'runner', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));

    // The runner returns between turns; Claude Code reports both events.
    live.observe(
      line({
        patch: { status: 'completed' },
        subtype: 'task_updated',
        task_id: 'runner',
        type: 'system',
      }),
    );
    live.observe(line({ subtype: 'task_notification', task_id: 'runner', type: 'system' }));
    expect(live.isOpen).toBe(true);

    // The wake-up turn starts a checker, ends, and the checker returns.
    live.observe(line({ subtype: 'init', type: 'system' }));
    live.observe(line({ type: 'assistant' }));
    live.observe(line({ subtype: 'task_started', task_id: 'checker', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    live.observe(line({ subtype: 'task_notification', task_id: 'checker', type: 'system' }));
    expect(live.isOpen).toBe(true);

    // That wake-up turn resumes the runner with SendMessage (same task id).
    live.observe(line({ subtype: 'init', type: 'system' }));
    live.observe(line({ type: 'assistant' }));
    live.observe(line({ subtype: 'task_started', task_id: 'runner', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    expect(live.isOpen).toBe(true);

    live.observe(line({ subtype: 'task_notification', task_id: 'runner', type: 'system' }));
    live.observe(line({ subtype: 'init', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    expect(live.isOpen).toBe(false);
  });

  it('holds stdin through a turn in which the last task ends, closing at its result', () => {
    const { live } = setup();
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));

    live.observe(line({ subtype: 'task_notification', task_id: 't-1', type: 'system' }));
    expect(live.isOpen).toBe(true);
    live.observe(line({ subtype: 'success', type: 'result' }));

    expect(live.isOpen).toBe(false);
  });

  it('closes when the last task ends between turns and no turn wakes up', () => {
    vi.useFakeTimers();
    const { live } = setup({ wakeUpGraceMs: 1000 });
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));

    live.observe(
      line({
        patch: { status: 'completed' },
        subtype: 'task_updated',
        task_id: 't-1',
        type: 'system',
      }),
    );

    vi.advanceTimersByTime(999);
    expect(live.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(live.isOpen).toBe(false);
  });

  // Recorded from claude 2.1.308: a stopped task reports `task_updated(killed)`
  // then `task_notification(stopped)`, and no turn follows.
  it.each([
    ['killed patch', { patch: { status: 'killed' }, subtype: 'task_updated' }],
    ['stopped notification', { status: 'stopped', subtype: 'task_notification' }],
  ])('closes at once when the last task is stopped between turns (%s)', (_, event) => {
    vi.useFakeTimers();
    const { live } = setup({ wakeUpGraceMs: 30_000 });
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));

    live.observe(line({ ...event, task_id: 't-1', type: 'system' }));
    expect(live.isOpen).toBe(false);
  });

  it('keeps stdin for the other task, or the open turn, when one task is stopped', () => {
    const { live } = setup();
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-2', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));

    live.observe(
      line({ status: 'stopped', subtype: 'task_notification', task_id: 't-1', type: 'system' }),
    );
    expect(live.isOpen).toBe(true);

    // Stopped mid-turn: that turn's own result decides.
    live.observe(line({ subtype: 'init', type: 'system' }));
    live.observe(
      line({ status: 'stopped', subtype: 'task_notification', task_id: 't-2', type: 'system' }),
    );
    expect(live.isOpen).toBe(true);
    live.observe(line({ subtype: 'success', type: 'result' }));
    expect(live.isOpen).toBe(false);
  });

  it('waits for a message delivered mid-turn to be picked up before closing', () => {
    const { live } = setup();
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));

    expect(live.send(userLine('interjection'), 'u-2')).toBe(true);
    live.observe(line({ subtype: 'success', type: 'result' }));
    expect(live.isOpen).toBe(true);

    // Claude Code starts a turn for the pending message.
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-2' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    expect(live.isOpen).toBe(false);
  });

  it('closes on a failed turn even while a task runs, but not on an interrupted one', () => {
    const failed = setup();
    failed.live.send(userLine('first'), 'u-1');
    failed.live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    failed.live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    failed.live.observe(
      line({ is_error: true, subtype: 'error_during_execution', type: 'result' }),
    );
    expect(failed.live.isOpen).toBe(false);

    const interrupted = setup();
    interrupted.live.send(userLine('first'), 'u-1');
    interrupted.live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    interrupted.live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    interrupted.live.observe(
      line({ is_error: true, terminal_reason: 'aborted_streaming', type: 'result' }),
    );
    expect(interrupted.live.isOpen).toBe(true);
  });

  it('rejects input after close so the caller can fall back to a new turn', async () => {
    const { live, written } = setup();
    live.close();
    await flush();

    expect(live.send(userLine('late'))).toBe(false);
    expect(live.interrupt()).toBe(false);
    expect(written).toEqual([]);
  });

  it('interrupts the current turn with a control request instead of a signal', async () => {
    const { live, written } = setup();

    expect(live.interrupt()).toBe(true);
    await flush();

    expect(written).toEqual([
      {
        request: { subtype: 'interrupt' },
        request_id: expect.any(String),
        type: 'control_request',
      },
    ]);
    expect(live.isOpen).toBe(true);
  });

  it('writes a generic control request and resolves with its control_response', async () => {
    const { live, written } = setup();

    const sent = live.sendControlRequest({ subtype: 'stop_task', task_id: 't-1' });
    await flush();

    expect(written).toEqual([
      {
        request: { subtype: 'stop_task', task_id: 't-1' },
        request_id: sent!.requestId,
        type: 'control_request',
      },
    ]);

    // Another request's answer and noise do not settle it.
    live.observe(
      line({ response: { request_id: 'other', subtype: 'success' }, type: 'control_response' }),
    );
    live.observe(
      line({
        response: { request_id: sent!.requestId, response: { stopped: true }, subtype: 'success' },
        type: 'control_response',
      }),
    );
    await expect(sent!.response).resolves.toEqual({
      response: { stopped: true },
      subtype: 'success',
    });
  });

  it('resolves a refused control request with its error', async () => {
    const { live } = setup();
    const sent = live.sendControlRequest({ subtype: 'stop_task', task_id: 'gone' });

    live.observe(
      line({
        response: { error: 'No task t-1', request_id: sent!.requestId, subtype: 'error' },
        type: 'control_response',
      }),
    );
    await expect(sent!.response).resolves.toEqual({ error: 'No task t-1', subtype: 'error' });
  });

  it('still takes an answer after input closed, and settles the rest when output ends', async () => {
    const { live } = setup();
    const answered = live.sendControlRequest({ subtype: 'a' })!;
    const unanswered = live.sendControlRequest({ subtype: 'b' })!;

    live.close();
    expect(live.sendControlRequest({ subtype: 'c' })).toBeUndefined();
    live.observe(
      line({
        response: { request_id: answered.requestId, subtype: 'success' },
        type: 'control_response',
      }),
    );
    live.finish();

    await expect(answered.response).resolves.toEqual({ response: undefined, subtype: 'success' });
    await expect(unanswered.response).resolves.toEqual({
      error: 'The session ended before answering',
      subtype: 'error',
    });
  });

  it('does not count a control response as session activity', () => {
    vi.useFakeTimers();
    const { live } = setup({ idleCloseMs: 1000 });
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    const sent = live.sendControlRequest({ subtype: 'stop_task', task_id: 't-1' })!;

    vi.advanceTimersByTime(600);
    live.observe(
      line({
        response: { request_id: sent.requestId, subtype: 'success' },
        type: 'control_response',
      }),
    );
    // Still between turns: the idle clock restarts on any output, as before.
    expect(live.isOpen).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(live.isOpen).toBe(false);
  });

  it('closes stdin after a silent stretch between turns so a stuck task cannot hold it open', () => {
    vi.useFakeTimers();
    const { live } = setup({ idleCloseMs: 1000 });
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));

    vi.advanceTimersByTime(999);
    expect(live.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(live.isOpen).toBe(false);
  });

  it('treats sub-agent output as background activity that keeps the idle timer fresh', () => {
    vi.useFakeTimers();
    const { live } = setup({ idleCloseMs: 1000, wakeUpGraceMs: 100 });
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));

    vi.advanceTimersByTime(800);
    live.observe(line({ parent_tool_use_id: 'tu-agent', type: 'assistant' }));
    vi.advanceTimersByTime(800);
    expect(live.isOpen).toBe(true);

    // A task the sub-agent starts still holds the session open.
    live.observe(
      line({
        parent_tool_use_id: 'tu-agent',
        subtype: 'task_started',
        task_id: 't-2',
        type: 'system',
      }),
    );
    live.observe(line({ subtype: 'task_notification', task_id: 't-2', type: 'system' }));
    expect(live.isOpen).toBe(true);

    // The sub-agent opened no main turn, so once its end wakes none, the
    // session is idle.
    live.observe(line({ subtype: 'task_notification', task_id: 't-1', type: 'system' }));
    vi.advanceTimersByTime(100);
    expect(live.isOpen).toBe(false);
  });

  it('does not let the idle timer fire during a main turn', () => {
    vi.useFakeTimers();
    const { live } = setup({ idleCloseMs: 1000 });
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));

    vi.advanceTimersByTime(500);
    live.observe(line({ subtype: 'init', type: 'system' }));
    vi.advanceTimersByTime(5000);

    expect(live.isOpen).toBe(true);
  });

  it('parses messages split across stdout chunks', () => {
    const { live } = setup();
    live.send(userLine('first'), 'u-1');
    const replay = line({ isReplay: true, type: 'user', uuid: 'u-1' });
    const result = line({ subtype: 'success', type: 'result' });

    live.observe(replay.slice(0, 10));
    live.observe(replay.slice(10) + result.slice(0, 5));
    expect(live.isOpen).toBe(true);
    live.observe(result.slice(5));

    expect(live.isOpen).toBe(false);
  });
});

describe('resolveClaudeCodeLiveRuntimeEnd', () => {
  const finished = { aborted: false, terminalReason: 'completed' };
  const exit = { code: 0, killedByHost: false, sawError: false, signal: null };

  it('ends the run complete at a clean exit after a finished turn', () => {
    expect(resolveClaudeCodeLiveRuntimeEnd(finished, exit)).toEqual({
      reason: 'complete',
      transport: 'cli-live',
    });
  });

  it('ends an interrupted last turn as aborted, though print mode exits 1', () => {
    expect(
      resolveClaudeCodeLiveRuntimeEnd(
        { aborted: true, terminalReason: 'aborted_streaming' },
        { ...exit, code: 1 },
      ),
    ).toEqual({
      kind: 'aborted',
      reason: 'interrupted',
      terminalReason: 'aborted_streaming',
      transport: 'cli-live',
    });
  });

  it('leaves the end to the exit path for a crash, a host kill, a reported error or no turn', () => {
    expect(resolveClaudeCodeLiveRuntimeEnd(finished, { ...exit, code: 2 })).toBeUndefined();
    expect(resolveClaudeCodeLiveRuntimeEnd(finished, { ...exit, code: 1 })).toBeUndefined();
    expect(
      resolveClaudeCodeLiveRuntimeEnd(finished, { ...exit, killedByHost: true }),
    ).toBeUndefined();
    expect(resolveClaudeCodeLiveRuntimeEnd(finished, { ...exit, sawError: true })).toBeUndefined();
    expect(resolveClaudeCodeLiveRuntimeEnd(undefined, exit)).toBeUndefined();
  });
});
