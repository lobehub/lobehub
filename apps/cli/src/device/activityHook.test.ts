import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityReporter, splitCommandLine } from './activityHook';

describe('splitCommandLine', () => {
  it.each([
    ['report', ['report']],
    ['  report   --id  dev-1 ', ['report', '--id', 'dev-1']],
    [`report 'a b' "c d"`, ['report', 'a b', 'c d']],
    [String.raw`report a\ b "x\"y" 'x\y'`, ['report', 'a b', 'x"y', String.raw`x\y`]],
    [`report ''`, ['report', '']],
    // No shell: operators and expansions are plain text.
    [
      'report; rm -rf ~ | tee $HOME > out',
      ['report;', 'rm', '-rf', '~', '|', 'tee', '$HOME', '>', 'out'],
    ],
    ['report "$(id)"', ['report', '$(id)']],
  ])('splits %s', (line, expected) => {
    expect(splitCommandLine(line)).toEqual(expected);
  });

  it('rejects unterminated quotes and empty commands', () => {
    expect(() => splitCommandLine(`report 'a`)).toThrow("unterminated ' quote");
    expect(() => splitCommandLine('   ')).toThrow('the command is empty');
  });
});

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
  unref = vi.fn();
}

describe('ActivityReporter', () => {
  let children: FakeChild[];
  let spawn: ReturnType<typeof vi.fn>;
  let debug: ReturnType<typeof vi.fn>;
  let busy: boolean;

  const createReporter = () =>
    new ActivityReporter({
      command: 'report --device "dev 1"',
      isBusy: () => busy,
      logger: { debug },
      spawn,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    children = [];
    busy = false;
    debug = vi.fn();
    spawn = vi.fn(() => {
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

  it('runs the split command without a shell when work starts', () => {
    const reporter = createReporter();
    reporter.begin();
    expect(spawn).toHaveBeenCalledWith('report', ['--device', 'dev 1']);
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
});
