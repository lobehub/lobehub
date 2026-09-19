import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeShell = {
  abi: 'a'.repeat(64),
  builtinDir: '/res/core',
  coreDir: '/res/core',
  log: ['loaded builtin'],
  manifest: null,
  markHealthy: vi.fn(),
  publicKey: '',
  shellVersion: '1.0.0',
  source: 'builtin' as const,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('shellInfo', () => {
  it('is undefined when the shell did not inject __SHELL__', async () => {
    vi.resetModules();
    const { shellInfo } = await import('../shell');
    expect(shellInfo).toBeUndefined();
  });

  it('captures __SHELL__ when present', async () => {
    vi.stubGlobal('__SHELL__', fakeShell);
    vi.resetModules();
    const { shellInfo } = await import('../shell');
    expect(shellInfo).toBe(fakeShell);
    expect(shellInfo?.coreDir).toBe('/res/core');
  });
});
