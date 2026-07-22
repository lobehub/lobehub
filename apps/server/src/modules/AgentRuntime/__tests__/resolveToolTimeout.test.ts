import { type LobeToolManifest } from '@lobechat/context-engine';
import { describe, expect, it, vi } from 'vitest';

import {
  GLOBAL_DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  resolveToolTimeoutMs,
} from '../resolveToolTimeout';

const makeManifest = (api: LobeToolManifest['api']): LobeToolManifest => ({
  api,
  identifier: 'lobe-local-system',
  meta: {},
});

describe('resolveToolTimeoutMs', () => {
  it('uses LLM-supplied args.timeout when present (highest priority)', () => {
    const manifest = makeManifest([
      { defaultTimeoutMs: 30_000, description: '', name: 'runCommand', parameters: {} },
    ]);
    expect(
      resolveToolTimeoutMs({ apiName: 'runCommand', args: { timeout: 240_000 }, manifest }),
    ).toBe(240_000);
  });

  it('falls back to manifest defaultTimeoutMs when args.timeout absent', () => {
    const manifest = makeManifest([
      { defaultTimeoutMs: 30_000, description: '', name: 'readFile', parameters: {} },
    ]);
    expect(resolveToolTimeoutMs({ apiName: 'readFile', args: {}, manifest })).toBe(30_000);
  });

  it('falls back to global default when neither args nor manifest specify', () => {
    const manifest = makeManifest([{ description: '', name: 'runCommand', parameters: {} }]);
    expect(resolveToolTimeoutMs({ apiName: 'runCommand', args: {}, manifest })).toBe(
      GLOBAL_DEFAULT_TIMEOUT_MS,
    );
  });

  it('falls back to global default when manifest is missing entirely', () => {
    expect(resolveToolTimeoutMs({ apiName: 'runCommand', args: undefined })).toBe(
      GLOBAL_DEFAULT_TIMEOUT_MS,
    );
  });

  it('clamps values above MAX_TIMEOUT_MS down to the cap', () => {
    expect(resolveToolTimeoutMs({ apiName: 'runCommand', args: { timeout: 10_000_000 } })).toBe(
      MAX_TIMEOUT_MS,
    );
  });

  it('clamps values below MIN_TIMEOUT_MS up to the floor', () => {
    expect(resolveToolTimeoutMs({ apiName: 'runCommand', args: { timeout: 1 } })).toBe(
      MIN_TIMEOUT_MS,
    );
  });

  it('ignores non-numeric args.timeout and falls through to next source', () => {
    const manifest = makeManifest([
      { defaultTimeoutMs: 45_000, description: '', name: 'runCommand', parameters: {} },
    ]);
    expect(
      resolveToolTimeoutMs({
        apiName: 'runCommand',
        // String value at runtime — defensive, the resolver should reject and fall through.
        args: { timeout: '240' } as unknown as Record<string, unknown>,
        manifest,
      }),
    ).toBe(45_000);
  });

  it('ignores zero / negative args.timeout and falls through', () => {
    const manifest = makeManifest([
      { defaultTimeoutMs: 45_000, description: '', name: 'runCommand', parameters: {} },
    ]);
    expect(resolveToolTimeoutMs({ apiName: 'runCommand', args: { timeout: 0 }, manifest })).toBe(
      45_000,
    );
    expect(resolveToolTimeoutMs({ apiName: 'runCommand', args: { timeout: -1 }, manifest })).toBe(
      45_000,
    );
  });

  it('ignores NaN/Infinity args.timeout and falls through', () => {
    const manifest = makeManifest([
      { defaultTimeoutMs: 45_000, description: '', name: 'runCommand', parameters: {} },
    ]);
    expect(
      resolveToolTimeoutMs({ apiName: 'runCommand', args: { timeout: Number.NaN }, manifest }),
    ).toBe(45_000);
    expect(
      resolveToolTimeoutMs({
        apiName: 'runCommand',
        args: { timeout: Number.POSITIVE_INFINITY },
        manifest,
      }),
    ).toBe(45_000);
  });

  it('ignores null/undefined args without crashing', () => {
    expect(resolveToolTimeoutMs({ apiName: 'runCommand', args: null })).toBe(
      GLOBAL_DEFAULT_TIMEOUT_MS,
    );
    expect(resolveToolTimeoutMs({ apiName: 'runCommand' })).toBe(GLOBAL_DEFAULT_TIMEOUT_MS);
  });

  it('matches the right API entry by name when manifest has multiple', () => {
    const manifest = makeManifest([
      { defaultTimeoutMs: 30_000, description: '', name: 'readFile', parameters: {} },
      { defaultTimeoutMs: 120_000, description: '', name: 'runCommand', parameters: {} },
      { defaultTimeoutMs: 60_000, description: '', name: 'grepContent', parameters: {} },
    ]);
    expect(resolveToolTimeoutMs({ apiName: 'grepContent', args: {}, manifest })).toBe(60_000);
  });

  it('truncates fractional values before clamping', () => {
    expect(resolveToolTimeoutMs({ apiName: 'runCommand', args: { timeout: 123_456.789 } })).toBe(
      123_456,
    );
  });

  it('never exceeds the remaining containing-step budget', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    expect(
      resolveToolTimeoutMs({
        apiName: 'runCommand',
        args: { timeout: 240_000 },
        deadlineAt: 1_030_000,
      }),
    ).toBe(30_000);

    nowSpy.mockRestore();
  });

  it('allows the remaining step budget to override the normal one-second floor', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    expect(
      resolveToolTimeoutMs({
        apiName: 'runCommand',
        deadlineAt: 1_000_250,
      }),
    ).toBe(250);

    nowSpy.mockRestore();
  });
});
