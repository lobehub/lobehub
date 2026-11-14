// Vitest resolves `debug` to its Node build (ANSI colors); the app bundles the browser one.
import type DebugModule from 'debug';
import browserDebug from 'debug/src/browser.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatConsoleArgs, installPlainDebugConsole } from './debugConsole';

describe('formatConsoleArgs', () => {
  // The arguments `debug` hands to `console.debug` for
  // `log('[completeOperation] operation %s (type=%s) completed, duration=%dms', id, type, ms)`;
  // `renderer.jsonl` used to record them space-joined and unformatted.
  it('formats a colored `debug` line into plain text', () => {
    expect(
      formatConsoleArgs([
        '%clobe-store:operation %c[completeOperation] operation %s (type=%s) completed, duration=%dms%c +1ms',
        'color: #33CC99',
        'color: inherit',
        'op_3HRIYF1B',
        'sendMessage',
        1627,
        'color: #33CC99',
      ]),
    ).toBe(
      'lobe-store:operation [completeOperation] operation op_3HRIYF1B (type=sendMessage) completed, duration=1627ms +1ms',
    );
  });

  it('serializes objects for %o / %O and appends leftover arguments', () => {
    expect(formatConsoleArgs(['loaded %o in %fms', { a: 1 }, 1.5, 'extra', { b: [2] }])).toBe(
      'loaded {"a":1} in 1.5ms extra {"b":[2]}',
    );
  });

  it('keeps %% literal and leaves specifiers without arguments untouched', () => {
    expect(formatConsoleArgs(['100%% done %s'])).toBe('100% done %s');
  });

  it('survives circular objects and errors', () => {
    const circular: Record<string, unknown> = { name: 'x' };
    circular.self = circular;
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at test';

    expect(formatConsoleArgs(['state %O', circular])).toBe(
      'state {"name":"x","self":"[Circular]"}',
    );
    expect(formatConsoleArgs([error])).toBe('Error: boom\n    at test');
  });
});

describe('installPlainDebugConsole', () => {
  const debug = browserDebug as typeof DebugModule;
  const originalLog = debug.log;

  afterEach(() => {
    debug.log = originalLog;
    debug.disable();
    vi.restoreAllMocks();
  });

  it('prints `debug` output as one formatted string', () => {
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    installPlainDebugConsole(debug);
    debug.enable('lobe-test:*');
    const log = debug('lobe-test:format');
    log.useColors = true;

    log('operation %s took %dms', 'op_abc', 12);

    expect(consoleDebug).toHaveBeenCalledTimes(1);
    const [line, ...rest] = consoleDebug.mock.calls[0];
    expect(rest).toEqual([]);
    expect(line).toMatch(/^lobe-test:format operation op_abc took 12ms \+\d+m?s$/);
    expect(line).not.toContain('%');
  });
});
