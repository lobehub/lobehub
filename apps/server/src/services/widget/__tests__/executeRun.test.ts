import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WidgetModel } from '@/database/models/widget';

import { executeWidgetRun, executeWidgetRunDetailed } from '../executeRun';
import { WidgetSandboxError } from '../sandbox/types';
import { WIDGET_BUSY_DEFER_DEADLINE_MS } from '../sandboxBusy';

vi.mock('@/database/models/widget', () => ({
  WidgetModel: { finishRun: vi.fn(async () => ({ folded: false, run: { id: 'run-1' } })) },
}));
vi.mock('../metrics', () => ({ recordWidgetMetrics: vi.fn() }));

const inject = [
  {
    header: 'Authorization',
    host: 'api.github.com',
    prefix: 'Bearer ',
    secretRef: { key: 'github' },
  },
];

const params = {
  run: { id: 'run-1', trigger: 'manual' },
  version: {
    manifest: {
      env: [{ connector: 'github', name: 'GITHUB_TOKEN' }],
      network: { allow: ['api.github.com'] },
    },
    outputType: 'stat',
    publishedByUserId: null,
    runtime: 'node',
    script: 'console.log("{}")',
    userId: 'u1',
  },
  widget: {
    agentId: null,
    id: 'widget-1',
    metricId: null,
    projectId: null,
    title: 'Stars',
    userId: 'u1',
    workspaceId: null,
  },
} as any;

describe('executeWidgetRun', () => {
  it('passes the allowlist to env resolution and forwards Market injects to the sandbox', async () => {
    const resolveEnv = vi.fn(async () => ({
      env: { GITHUB_TOKEN: 'lh_ph_0123456789abcdef' },
      inject,
    }));
    const run = vi.fn(async () => ({
      durationMs: 10,
      exitCode: 0,
      stderr: 'sent lh_ph_0123456789abcdef',
      stdout: '{"type":"stat","value":1}',
      timedOut: false,
    }));

    await executeWidgetRun({} as any, params, { resolveEnv, runner: { run } });

    expect(resolveEnv).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ authorUserId: 'u1' }),
      params.version.manifest.env,
      { networkAllow: ['api.github.com'] },
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { GITHUB_TOKEN: 'lh_ph_0123456789abcdef' },
        network: { allow: ['api.github.com'], inject },
      }),
    );
    // The placeholder is redacted like any env value; it never breaks the run.
    expect(vi.mocked(WidgetModel.finishRun)).toHaveBeenCalledWith(
      {},
      'run-1',
      expect.objectContaining({ status: 'succeeded', stderr: 'sent [REDACTED:GITHUB_TOKEN]' }),
      // the transactional metric publisher `finishRun` folds into the same tx
      expect.any(Function),
    );
  });

  it('sends no inject list when nothing needs one', async () => {
    const run = vi.fn(async () => ({
      durationMs: 10,
      exitCode: 0,
      stderr: '',
      stdout: '{"type":"stat","value":1}',
      timedOut: false,
    }));

    await executeWidgetRun({} as any, params, {
      resolveEnv: vi.fn(async () => ({ env: {}, inject: [] })),
      runner: { run },
    });

    expect((run.mock.calls[0] as any[])[0].network).toEqual({ allow: ['api.github.com'] });
  });
});

describe('executeWidgetRun when the sandbox is busy', () => {
  const busy = (retryAfterMs = 5000) =>
    new WidgetSandboxError(
      'SANDBOX_BUSY',
      'Sandbox is busy for this account: concurrency_limited',
      {
        retryAfterMs,
      },
    );
  const ran = {
    durationMs: 10,
    exitCode: 0,
    stderr: '',
    stdout: '{"type":"stat","value":1}',
    timedOut: false,
  };
  const resolveEnv = vi.fn(async () => ({ env: {}, inject: [] }));
  const finishRun = vi.mocked(WidgetModel.finishRun);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    finishRun.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('a run someone waits on (manual / preview)', () => {
    it('retries in process honouring Retry-After, then closes with the result', async () => {
      const run = vi
        .fn()
        .mockRejectedValueOnce(busy(5000))
        .mockRejectedValueOnce(busy(2000))
        .mockResolvedValueOnce(ran);

      const pending = executeWidgetRun({} as any, params, { resolveEnv, runner: { run } });
      await vi.advanceTimersByTimeAsync(4999);
      expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000);
      await pending;

      expect(run).toHaveBeenCalledTimes(3);
      expect(finishRun).toHaveBeenCalledWith(
        {},
        'run-1',
        expect.objectContaining({ status: 'succeeded' }),
        expect.any(Function),
      );
    });

    it('gives up after three attempts with a clear SANDBOX_BUSY failure', async () => {
      const run = vi.fn().mockRejectedValue(busy(5000));

      const pending = executeWidgetRun({} as any, params, { resolveEnv, runner: { run } });
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;

      expect(run).toHaveBeenCalledTimes(3);
      expect(finishRun).toHaveBeenCalledWith(
        {},
        'run-1',
        expect.objectContaining({
          error: {
            code: 'SANDBOX_BUSY',
            message: expect.stringContaining('busy with other widget runs of this account'),
          },
          status: 'failed',
        }),
        expect.any(Function),
      );
    });

    it('does not start a wait that would overrun the retry budget', async () => {
      // rate_limited at the start of a minute: the next slot is ~60 s away.
      const run = vi.fn().mockRejectedValue(busy(59_000));

      await executeWidgetRun({} as any, params, { resolveEnv, runner: { run } });

      expect(run).toHaveBeenCalledTimes(1);
      expect(finishRun).toHaveBeenCalledWith(
        {},
        'run-1',
        expect.objectContaining({ error: expect.objectContaining({ code: 'SANDBOX_BUSY' }) }),
        expect.any(Function),
      );
    });
  });

  describe('a scheduled run', () => {
    const scheduled = (createdAt: Date, schedulePattern: string | null = '0 * * * *') => ({
      ...params,
      run: { createdAt, id: 'run-1', startedAt: createdAt, trigger: 'schedule' },
      widget: { ...params.widget, schedulePattern, scheduleTimezone: null },
    });

    it('stays reserved instead of failing, without retrying in process', async () => {
      vi.setSystemTime(new Date('2026-10-25T08:00:05Z'));
      const run = vi.fn().mockRejectedValue(busy());

      await expect(
        executeWidgetRunDetailed({} as any, scheduled(new Date('2026-10-25T08:00:00Z')), {
          resolveEnv,
          runner: { run },
        }),
      ).resolves.toEqual({ deferred: true, run: undefined });

      expect(run).toHaveBeenCalledTimes(1);
      expect(finishRun).not.toHaveBeenCalled();
    });

    it('closes as failed SANDBOX_BUSY once it has waited past the deadline', async () => {
      const createdAt = new Date('2026-10-25T08:00:00Z');
      vi.setSystemTime(createdAt.getTime() + WIDGET_BUSY_DEFER_DEADLINE_MS + 1);
      const run = vi.fn().mockRejectedValue(busy());

      const result = await executeWidgetRunDetailed({} as any, scheduled(createdAt), {
        resolveEnv,
        runner: { run },
      });

      expect(result.deferred).toBeUndefined();
      expect(finishRun).toHaveBeenCalledWith(
        {},
        'run-1',
        expect.objectContaining({
          error: expect.objectContaining({ code: 'SANDBOX_BUSY' }),
          expectedStartedAt: createdAt,
          status: 'failed',
        }),
        expect.any(Function),
      );
    });

    it('stops waiting when the widget’s next slot arrives first', async () => {
      // Every 10 minutes: the next slot (08:10) comes before the 30-minute bound.
      vi.setSystemTime(new Date('2026-10-25T08:10:30Z'));
      const run = vi.fn().mockRejectedValue(busy());

      const result = await executeWidgetRunDetailed(
        {} as any,
        scheduled(new Date('2026-10-25T08:00:00Z'), '*/10 * * * *'),
        { resolveEnv, runner: { run } },
      );

      expect(result.deferred).toBeUndefined();
      expect(finishRun).toHaveBeenCalledWith(
        {},
        'run-1',
        expect.objectContaining({ status: 'failed' }),
        expect.any(Function),
      );
    });

    it('fails other sandbox errors at once, as before', async () => {
      vi.setSystemTime(new Date('2026-10-25T08:00:05Z'));
      const run = vi
        .fn()
        .mockRejectedValue(new WidgetSandboxError('SANDBOX_ERROR', 'HTTP 503: unavailable'));

      const result = await executeWidgetRunDetailed(
        {} as any,
        scheduled(new Date('2026-10-25T08:00:00Z')),
        { resolveEnv, runner: { run } },
      );

      expect(result.deferred).toBeUndefined();
      expect(finishRun).toHaveBeenCalledWith(
        {},
        'run-1',
        expect.objectContaining({ error: expect.objectContaining({ code: 'SANDBOX_ERROR' }) }),
        expect.any(Function),
      );
    });
  });
});
