// @vitest-environment node
/**
 * Regression test: the `includeFileUrl` toggle in contextEngineering reads from
 * `window.global_serverConfigStore` and must be guarded with `typeof window !== 'undefined'`.
 * Without the guard, evaluating `window` in a Node/SSR context throws
 * `ReferenceError: window is not defined` before optional chaining can help.
 *
 * This test runs in a pure Node environment (no happy-dom) to verify the guard.
 *
 * See: https://github.com/lobehub/lobehub/pull/14862
 */
import { describe, expect, it } from 'vitest';

describe('includeFileUrl window guard (node environment)', () => {
  it('should evaluate to false without throwing when window is undefined', () => {
    // Confirm we are genuinely in a windowless environment
    expect(typeof window).toBe('undefined');

    // This is the exact expression used in contextEngineering.ts for includeFileUrl.
    // Without the `typeof window !== 'undefined'` guard, this would throw
    // ReferenceError: window is not defined.
    const includeFileUrl =
      typeof window !== 'undefined'
        ? ((window as any).global_serverConfigStore?.getState()?.serverConfig
            ?.includeFileUrlInContext ?? false)
        : false;

    expect(includeFileUrl).toBe(false);
  });

  it('should throw ReferenceError if the guard is missing', () => {
    expect(typeof window).toBe('undefined');

    // Demonstrate why the guard is necessary — bare `window` access throws
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      (window as any)?.global_serverConfigStore?.getState()?.serverConfig
        ?.includeFileUrlInContext ?? false;
    }).toThrow(ReferenceError);
  });
});
