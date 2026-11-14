import { afterEach, expect, it, vi } from 'vitest';

import { armRunWatchdog } from './runWatchdog';

afterEach(() => vi.useRealTimers());

it('waits for cleanup before fatal exit and reports cleanup failures', async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  armRunWatchdog({
    cleanup: async () => {
      events.push('cleanup');
      throw new Error('cleanup failed');
    },
    durationMs: 10,
    report: (message) => events.push(String(message)),
    terminate: (code) => events.push(`exit:${code}`),
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(events).toEqual([
    'ERROR: VERIFICATION_TIME_BUDGET_EXCEEDED',
    'cleanup',
    'Error: cleanup failed',
    'exit:3',
  ]);
});

it('can be disposed and bounds a stuck cleanup attempt', async () => {
  vi.useFakeTimers();
  const cleanup = vi.fn(() => new Promise<void>(() => {}));
  const terminate = vi.fn();
  const report = vi.fn();
  armRunWatchdog({ cleanup, durationMs: 10, report, terminate })();
  await vi.advanceTimersByTimeAsync(20);
  expect(cleanup).not.toHaveBeenCalled();
  armRunWatchdog({ cleanup, durationMs: 10, report, terminate });
  await vi.advanceTimersByTimeAsync(120_010);
  expect(report).toHaveBeenCalledWith('ERROR: SOURCE_CLEANUP_TIME_BUDGET_EXCEEDED');
  expect(terminate).toHaveBeenCalledWith(3);
});
