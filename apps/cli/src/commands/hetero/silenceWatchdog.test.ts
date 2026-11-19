import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SILENCE_WATCHDOG_CONFIG,
  HeteroSilenceWatchdog,
  iterateUntil,
  resolveSilenceWatchdogConfig,
  startSilenceWatchdog,
} from './silenceWatchdog';

const MIN = 60_000;
const config = DEFAULT_SILENCE_WATCHDOG_CONFIG;

const event = (type: AgentStreamEvent['type'], data: any = {}): AgentStreamEvent => ({
  data,
  operationId: 'op-1',
  stepIndex: 0,
  timestamp: 0,
  type,
});

const toolStart = (id: string, apiName: string, input: Record<string, unknown> = {}) =>
  event('tool_start', {
    toolCalling: { apiName, arguments: JSON.stringify(input), id, identifier: 'claude-code' },
  });

describe('HeteroSilenceWatchdog', () => {
  it('stops a process that never produces output after the startup window', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);

    expect(watchdog.check(3 * MIN - 1)).toBeUndefined();
    expect(watchdog.check(3 * MIN)).toMatchObject({
      kind: 'startup',
      message: expect.stringContaining('never started a session'),
    });
  });

  it('allows the model the full silence window after the last output', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);
    watchdog.observe(toolStart('t1', 'Read'), 1 * MIN);
    watchdog.observe(event('tool_result', { toolCallId: 't1' }), 2 * MIN);

    expect(watchdog.check(2 * MIN + 15 * MIN - 1)).toBeUndefined();
    const timeout = watchdog.check(17 * MIN);
    expect(timeout).toMatchObject({ kind: 'model', silentMs: 15 * MIN });
    expect(timeout?.message).toContain('received the result of tool `Read`');
  });

  it('keeps a run alive while raw output keeps arriving', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);
    for (let at = 0; at <= 60 * MIN; at += 5 * MIN) watchdog.touch(at);

    expect(watchdog.check(70 * MIN)).toBeUndefined();
  });

  it('ignores the wrapper heartbeat, which says nothing about the agent', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);
    watchdog.touch(0);
    watchdog.observe(event('step_complete', { phase: 'operation_heartbeat' }), 14 * MIN);

    expect(watchdog.check(15 * MIN)?.kind).toBe('model');
  });

  it('stops a Bash call that outlives its declared timeout plus grace', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);
    // A 10-minute Bash: Claude Code itself kills it at 10m, so 12m is the hang line.
    watchdog.observe(toolStart('b1', 'Bash', { command: 'make', timeout: 10 * MIN }), 0);

    expect(watchdog.check(12 * MIN - 1)).toBeUndefined();
    // Still inside the 15-minute floor every run gets after its last output.
    expect(watchdog.check(14 * MIN)).toBeUndefined();
    const timeout = watchdog.check(15 * MIN);
    expect(timeout).toMatchObject({ kind: 'tool', toolName: 'Bash' });
    expect(timeout?.message).toContain('past its 10m timeout');
  });

  it('caps a declared Bash timeout at the largest one Claude Code accepts', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);
    watchdog.observe(toolStart('b1', 'Bash', { timeout: 120 * MIN }), 0);

    expect(watchdog.check(15 * MIN)).toMatchObject({ kind: 'tool' });
  });

  it('gives a tool without a timeout of its own the longer tool window', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);
    watchdog.observe(toolStart('m1', 'mcp__build__run'), 0);

    expect(watchdog.check(29 * MIN)).toBeUndefined();
    expect(watchdog.check(30 * MIN)).toMatchObject({
      kind: 'tool',
      message: expect.stringContaining('`mcp__build__run` had been running for 30m'),
    });
  });

  it('treats a background Bash as returned once its result arrives', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);
    watchdog.observe(toolStart('b1', 'Bash', { run_in_background: true }), 0);
    watchdog.observe(event('tool_result', { toolCallId: 'b1' }), 0);
    watchdog.observe(
      event('background_task', { task: { status: 'running', taskId: 'task-1' }, toolCallId: 'b1' }),
      0,
    );

    expect(watchdog.check(44 * MIN)).toBeUndefined();
    expect(watchdog.check(45 * MIN)?.kind).toBe('background');

    watchdog.observe(
      event('background_task', { task: { status: 'completed', taskId: 'task-1' } }),
      45 * MIN,
    );
    expect(watchdog.check(59 * MIN)).toBeUndefined();
    expect(watchdog.check(60 * MIN)?.kind).toBe('model');
  });

  it('closes a tool on tool_end too, e.g. when the adapter abandons it', () => {
    const watchdog = new HeteroSilenceWatchdog(config, 0);
    watchdog.observe(toolStart('m1', 'WebFetch'), 0);
    watchdog.observe(event('tool_end', { isSuccess: false, toolCallId: 'm1' }), 0);

    expect(watchdog.check(15 * MIN)?.kind).toBe('model');
  });
});

describe('resolveSilenceWatchdogConfig', () => {
  it('uses the documented defaults', () => {
    expect(resolveSilenceWatchdogConfig({})).toEqual(DEFAULT_SILENCE_WATCHDOG_CONFIG);
  });

  it('reads minute overrides and ignores invalid values', () => {
    expect(
      resolveSilenceWatchdogConfig({
        LOBE_HETERO_WATCHDOG_SILENCE_MINUTES: '20',
        LOBE_HETERO_WATCHDOG_STARTUP_MINUTES: 'soon',
        LOBE_HETERO_WATCHDOG_TOOL_SILENCE_MINUTES: '-1',
      }),
    ).toMatchObject({ silenceMs: 20 * MIN, startupMs: 3 * MIN, toolSilenceMs: 30 * MIN });
  });

  it("follows Claude Code's own Bash timeout settings", () => {
    expect(
      resolveSilenceWatchdogConfig({
        BASH_DEFAULT_TIMEOUT_MS: String(5 * MIN),
        BASH_MAX_TIMEOUT_MS: String(60 * MIN),
      }),
    ).toMatchObject({ bashDefaultTimeoutMs: 5 * MIN, maxToolTimeoutMs: 60 * MIN });
  });

  it('can be disabled', () => {
    expect(resolveSilenceWatchdogConfig({ LOBE_HETERO_WATCHDOG_DISABLED: '1' })).toBeUndefined();
  });
});

describe('startSilenceWatchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once on the timer when the process stays silent', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startSilenceWatchdog({ config, onTimeout });

    vi.advanceTimersByTime(3 * MIN - 15_000);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ kind: 'startup' }));

    vi.advanceTimersByTime(60 * MIN);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not count time spent waiting on the user', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let waitingOnUser = true;
    const runner = startSilenceWatchdog({
      config,
      isPaused: () => waitingOnUser,
      onTimeout,
    });
    runner.touch();

    vi.advanceTimersByTime(60 * MIN);
    expect(onTimeout).not.toHaveBeenCalled();

    waitingOnUser = false;
    vi.advanceTimersByTime(15 * MIN - 15_000);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15_000);
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ kind: 'model' }));
  });

  it('never fires after stop', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startSilenceWatchdog({ config, onTimeout }).stop();

    vi.advanceTimersByTime(60 * MIN);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('iterateUntil', () => {
  it('stops waiting on a stream that never ends once released', async () => {
    let release!: () => void;
    const stop = new Promise<void>((resolve) => (release = resolve));
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => {
        let sent = false;
        return {
          next: () =>
            sent
              ? new Promise<IteratorResult<number>>(() => {})
              : ((sent = true), Promise.resolve({ done: false, value: 1 })),
        };
      },
    };

    const seen: number[] = [];
    const done = (async () => {
      for await (const value of iterateUntil(source, stop)) seen.push(value);
    })();
    release();
    await done;
    expect(seen).toEqual([1]);
  });
});
