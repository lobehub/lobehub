import * as childProcess from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAntigravityQuota, parseAntigravityQuota } from './antigravityQuota';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('../spawn/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: vi.fn(async () => ({ command: '/bin/agy', pathEnv: '/resolved/bin' })),
}));
vi.mock('../spawn/cliSpawn', () => ({
  resolveCliSpawnPlan: vi.fn(async (command: string, args: string[]) => ({ command, args })),
}));

const envelope = (buckets: unknown[] = []) => ({
  status: 'SUCCESS',
  command: { name: 'usage', data: { groups: [{ name: 'Gemini', buckets }] } },
});
const bucket = {
  id: 'gemini-weekly',
  name: 'Weekly',
  remaining_fraction: 0.939,
  reset_time: '2026-11-06T02:52:08Z',
  window: 'weekly',
};
const respond = (stdout: string, error: Error | null = null) =>
  vi.mocked(childProcess.execFile).mockImplementationOnce(((...args: unknown[]) => {
    const callback = args.at(-1) as (
      error: Error | null,
      result: { stdout: string; stderr: string },
    ) => void;
    callback(error, { stdout, stderr: '' });
    return {} as childProcess.ChildProcess;
  }) as typeof childProcess.execFile);

describe('Antigravity quota sampler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves native groups and bucket ids without rolling expired readings to full', () => {
    expect(parseAntigravityQuota(envelope([bucket]))).toEqual([
      {
        name: 'Gemini',
        buckets: [
          {
            id: bucket.id,
            name: 'Weekly',
            remainingFraction: 0.939,
            remainingAmount: null,
            resetsAt: Date.parse(bucket.reset_time),
            window: 'weekly',
            disabled: false,
          },
        ],
      },
    ]);
    expect(
      parseAntigravityQuota(envelope([{ ...bucket, remaining_fraction: 0.5 }]))[0].buckets[0]
        .remainingFraction,
    ).toBe(0.5);
    expect(
      parseAntigravityQuota(envelope([{ ...bucket, remaining_fraction: 0.9 }]))[0].buckets[0]
        .remainingFraction,
    ).toBe(0.9);
  });

  it('keeps missing percentages unknown, zero distinct, disabled buckets and future window types', () => {
    const groups = parseAntigravityQuota(
      envelope([
        { id: 'unknown', remaining_fraction: 2, reset_time: 'invalid' },
        { id: 'empty', remaining_fraction: 0 },
        { id: 'amount', remaining_amount: 24, window: 'dynamic', disabled: true },
        { id: 'amount', remaining_fraction: 1 },
        null,
      ]),
    );
    expect(groups[0].buckets).toHaveLength(3);
    expect(groups[0].buckets[0]).toMatchObject({ remainingFraction: null, resetsAt: null });
    expect(groups[0].buckets[1].remainingFraction).toBe(0);
    expect(groups[0].buckets[2]).toMatchObject({
      disabled: true,
      remainingAmount: 24,
      remainingFraction: null,
      window: 'dynamic',
    });
  });

  it.each([
    {},
    { status: 'SUCCESS', response: '100%' },
    { status: 'ERROR' },
    { status: 'SUCCESS', command: { name: 'credits', data: { groups: [] } } },
  ])('rejects unsupported payloads instead of presenting zero usage: %j', (payload) => {
    expect(() => parseAntigravityQuota(payload)).toThrow();
  });

  it('queries only the native usage command with a bounded subprocess and caller environment', async () => {
    respond(JSON.stringify(envelope([bucket])));
    const result = await fetchAntigravityQuota({
      command: '/bin/agy',
      env: { AGY_TEST: 'profile', PATH: '/caller/bin' },
    });
    expect(result.status).toBe('ok');
    expect(result.groups[0].buckets[0].remainingFraction).toBe(0.939);
    expect(childProcess.execFile).toHaveBeenCalledWith(
      '/bin/agy',
      ['-p', '/usage', '--output-format', 'json', '--print-timeout', '15s'],
      expect.objectContaining({
        env: expect.objectContaining({ AGY_TEST: 'profile', PATH: '/caller/bin' }),
        timeout: 20_000,
        killSignal: 'SIGKILL',
        windowsHide: true,
      }),
      expect.any(Function),
    );
  });

  it.each([
    [Object.assign(new Error('missing'), { code: 'ENOENT' }), 'cli_not_found'],
    [Object.assign(new Error('timeout'), { killed: true }), 'timeout'],
    [Object.assign(new Error('failed'), { stderr: 'authentication required' }), 'auth_required'],
  ])('classifies process failures without exposing raw stderr', async (error, code) => {
    respond('', error);
    expect(await fetchAntigravityQuota()).toMatchObject({ errorCode: code, groups: [] });
  });

  it('reports old command formats and failed command envelopes', async () => {
    respond('Weekly\t100%');
    expect((await fetchAntigravityQuota()).errorCode).toBe('unsupported_client');
    respond(JSON.stringify({ status: 'ERROR', error: 'authentication required' }));
    expect((await fetchAntigravityQuota()).errorCode).toBe('auth_required');
  });
});
