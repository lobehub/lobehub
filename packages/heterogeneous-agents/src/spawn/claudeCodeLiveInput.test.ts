import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeLiveInput } from './claudeCodeLiveInput';

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

  it('keeps stdin open past the result while a background task runs', () => {
    const { live } = setup();
    live.send(userLine('first'), 'u-1');

    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));
    expect(live.isOpen).toBe(true);

    // Print mode still runs the notification turn after stdin closes.
    live.observe(line({ subtype: 'task_notification', task_id: 't-1', type: 'system' }));
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

  it('closes when the last background task ends between turns', () => {
    const { live } = setup();
    live.send(userLine('first'), 'u-1');
    live.observe(line({ isReplay: true, type: 'user', uuid: 'u-1' }));
    live.observe(line({ subtype: 'task_started', task_id: 't-1', type: 'system' }));
    live.observe(line({ subtype: 'success', type: 'result' }));

    live.observe(
      line({
        patch: { status: 'killed' },
        subtype: 'task_updated',
        task_id: 't-1',
        type: 'system',
      }),
    );

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
    const { live } = setup({ idleCloseMs: 1000 });
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

    // The sub-agent opened no main turn, so its end leaves the session idle.
    live.observe(line({ subtype: 'task_notification', task_id: 't-1', type: 'system' }));
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
