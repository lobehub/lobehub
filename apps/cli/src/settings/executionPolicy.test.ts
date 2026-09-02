import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = path.join(os.tmpdir(), 'lobehub-cli-test-execution-policy');
const settingsDir = path.join(tmpDir, '.lobehub');
const cacheFile = path.join(settingsDir, 'execution-policy-cache.json');

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: () => tmpDir,
    },
  };
});

vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), warn: vi.fn() },
}));

const mutate = vi.fn();
const getTrpcClientMock = vi.fn(async () => ({ executionPolicy: { get: { mutate } } }));
vi.mock('../api/client', () => ({
  getTrpcClient: (...args: unknown[]) => getTrpcClientMock(...args),
}));

const getValidToken = vi.fn();
vi.mock('../auth/refresh', () => ({
  getValidToken: (...args: unknown[]) => getValidToken(...args),
}));

const readCliApiKeyEnv = vi.fn();
vi.mock('../constants/auth', () => ({
  readCliApiKeyEnv: (...args: unknown[]) => readCliApiKeyEnv(...args),
}));

describe('resolvePushedCommandMode', () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    delete process.env.LOBEHUB_JWT;
    mutate.mockReset();
    getTrpcClientMock.mockClear();
    getValidToken.mockReset().mockResolvedValue({ credentials: {} });
    readCliApiKeyEnv.mockReset().mockReturnValue(undefined);

    const { resetExecutionPolicyCache } = await import('./executionPolicy');
    resetExecutionPolicyCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
    vi.resetModules();
  });

  it('returns and caches the pushed mode on a successful fetch', async () => {
    mutate.mockResolvedValue({ commandMode: 'sandbox', enabled: true, writableRoots: [] });

    const { resolvePushedCommandMode } = await import('./executionPolicy');
    const mode = await resolvePushedCommandMode();

    expect(mode).toBe('sandbox');
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toEqual({ commandMode: 'sandbox' });
  });

  it('returns undefined (no push-down) when the server has no policy for this user', async () => {
    mutate.mockResolvedValue(null);

    const { resolvePushedCommandMode } = await import('./executionPolicy');
    const mode = await resolvePushedCommandMode();

    expect(mode).toBeUndefined();
  });

  it('falls back to the last successfully cached mode when a later fetch fails', async () => {
    mutate.mockResolvedValueOnce({ commandMode: 'sandbox', enabled: true, writableRoots: [] });
    const { resolvePushedCommandMode, resetExecutionPolicyCache } =
      await import('./executionPolicy');
    expect(await resolvePushedCommandMode()).toBe('sandbox');

    // Simulate a later call, past the memo TTL, hitting a network failure.
    resetExecutionPolicyCache();
    mutate.mockRejectedValueOnce(new Error('network down'));

    expect(await resolvePushedCommandMode()).toBe('sandbox');
  });

  it('falls back to the strictest default when it has never fetched successfully', async () => {
    mutate.mockRejectedValue(new Error('network down'));

    const { resolvePushedCommandMode } = await import('./executionPolicy');
    const mode = await resolvePushedCommandMode();

    expect(mode).toBe('sandbox');
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it('relaxes a previously cached mode once a successful fetch reports no policy', async () => {
    mutate.mockResolvedValueOnce({ commandMode: 'sandbox', enabled: true, writableRoots: [] });
    const { resolvePushedCommandMode, resetExecutionPolicyCache } =
      await import('./executionPolicy');
    expect(await resolvePushedCommandMode()).toBe('sandbox');

    resetExecutionPolicyCache();
    mutate.mockResolvedValueOnce(null);
    expect(await resolvePushedCommandMode()).toBeUndefined();

    // And a subsequent failure now falls back to the RELAXED cached state,
    // not the stale 'sandbox' from before the admin lifted the policy.
    resetExecutionPolicyCache();
    mutate.mockRejectedValueOnce(new Error('network down'));
    expect(await resolvePushedCommandMode()).toBeUndefined();
  });

  it('resolves the overlay from a successful fetch', async () => {
    mutate.mockResolvedValue({
      allowedNetworkDomains: ['*.internal.example.com'],
      commandMode: 'auto',
      deniedWriteRoots: ['~/.ssh'],
      enabled: true,
      writableRoots: ['~/Downloads'],
    });

    const { resolveExecutionPolicyOverlay } = await import('./executionPolicy');
    const overlay = await resolveExecutionPolicyOverlay();

    expect(overlay).toEqual({
      allowedNetworkDomains: ['*.internal.example.com'],
      deniedReadRoots: undefined,
      deniedWriteRoots: ['~/.ssh'],
      envAllowlist: undefined,
      readableRoots: undefined,
      writableRoots: ['~/Downloads'],
    });
  });

  it('falls back to no overlay (not a cached one) when a fetch fails', async () => {
    mutate.mockResolvedValue({
      commandMode: 'auto',
      enabled: true,
      writableRoots: ['~/Downloads'],
    });
    const { resolveExecutionPolicyOverlay, resetExecutionPolicyCache } =
      await import('./executionPolicy');
    expect(await resolveExecutionPolicyOverlay()).toBeDefined();

    resetExecutionPolicyCache();
    mutate.mockRejectedValueOnce(new Error('network down'));
    expect(await resolveExecutionPolicyOverlay()).toBeUndefined();
  });

  it('never calls the network client when no credentials are resolvable', async () => {
    getValidToken.mockResolvedValue(null);
    readCliApiKeyEnv.mockReturnValue(undefined);

    const { resolvePushedCommandMode } = await import('./executionPolicy');

    const mode = await resolvePushedCommandMode();

    expect(mode).toBe('sandbox');
    expect(getTrpcClientMock).not.toHaveBeenCalled();
  });
});
