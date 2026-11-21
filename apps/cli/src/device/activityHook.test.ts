import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityReporter } from './activityHook';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
  unref = vi.fn();
}

describe('ActivityReporter', () => {
  let children: FakeChild[];
  let debug: ReturnType<typeof vi.fn>;
  let busy: boolean;

  const createReporter = () =>
    new ActivityReporter({
      command: ['report', '--device', 'dev 1'],
      isBusy: () => busy,
      logger: { debug },
    });

  beforeEach(() => {
    vi.useFakeTimers();
    children = [];
    busy = false;
    debug = vi.fn();
    spawn.mockReset().mockImplementation(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const finishAll = (code = 0) => {
    for (const child of children) child.emit('exit', code, null);
  };

  it('runs the command without a shell when work starts', () => {
    const reporter = createReporter();
    reporter.begin();
    expect(spawn).toHaveBeenCalledWith(
      'report',
      ['--device', 'dev 1'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('runs at most once per 30 s however much work arrives', () => {
    const reporter = createReporter();
    reporter.begin()();
    finishAll();
    reporter.begin()();
    vi.advanceTimersByTime(29_999);
    reporter.begin()();
    expect(spawn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    reporter.begin()();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('never runs two at a time', () => {
    const reporter = createReporter();
    reporter.begin();
    vi.advanceTimersByTime(5000);
    expect(children[0].kill).not.toHaveBeenCalled();
    // Still running after the interval: skip rather than stack a second one.
    vi.setSystemTime(Date.now() + 30_000);
    reporter.begin();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('kills a hook that hangs, logging at debug level', () => {
    const reporter = createReporter();
    reporter.begin();
    vi.advanceTimersByTime(10_000);
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('killed it'));
  });

  it('re-reports every 30 s while work continues, then goes quiet', () => {
    const reporter = createReporter();
    reporter.start();
    const end = reporter.begin();
    finishAll();

    vi.advanceTimersByTime(30_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    finishAll();

    end();
    vi.advanceTimersByTime(90_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    reporter.stop();
  });

  it('keeps runs about 30 s apart when work starts between two checks', () => {
    const reporter = createReporter();
    reporter.start();
    vi.advanceTimersByTime(12_000);
    reporter.begin();
    finishAll();

    // 30 s after the first run, not at the next 30 s boundary of the ticker.
    vi.advanceTimersByTime(29_999);
    expect(spawn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(spawn).toHaveBeenCalledTimes(2);
    reporter.stop();
  });

  it('reports polled work (agent runs, tunnels) on the interval', () => {
    const reporter = createReporter();
    reporter.start();
    vi.advanceTimersByTime(30_000);
    expect(spawn).not.toHaveBeenCalled();

    busy = true;
    vi.advanceTimersByTime(30_000);
    expect(spawn).toHaveBeenCalledTimes(1);
    reporter.stop();
  });

  it('logs failures at debug level only and never throws into the work', () => {
    spawn.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    const reporter = createReporter();
    expect(() => reporter.begin()).not.toThrow();
    expect(debug).toHaveBeenCalledWith('Activity command could not start: EACCES');

    vi.advanceTimersByTime(30_000);
    reporter.begin();
    children[0].emit('error', new Error('spawn report ENOENT'));
    expect(debug).toHaveBeenCalledWith('Activity command failed: spawn report ENOENT');

    vi.advanceTimersByTime(30_000);
    reporter.begin();
    children[1].emit('exit', 3, null);
    expect(debug).toHaveBeenCalledWith('Activity command exited with 3');
  });

  it('kills a running hook and clears its kill timer on stop', () => {
    const reporter = createReporter();
    reporter.start();
    reporter.begin();
    expect(vi.getTimerCount()).toBe(2);

    reporter.stop();
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);

    // The killed child settling later is ignored.
    expect(() => {
      children[0].emit('exit', null, 'SIGKILL');
      children[0].emit('error', new Error('late'));
    }).not.toThrow();
    expect(debug).not.toHaveBeenCalled();
  });

  it('runs nothing after stop', () => {
    const reporter = createReporter();
    reporter.stop();
    reporter.start();
    busy = true;
    reporter.begin();
    vi.advanceTimersByTime(60_000);
    expect(spawn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops cleanly when no hook is running', () => {
    const reporter = createReporter();
    reporter.begin();
    finishAll();
    reporter.stop();
    expect(children[0].kill).not.toHaveBeenCalled();
  });
});
