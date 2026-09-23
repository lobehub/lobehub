import { describe, expect, it } from 'vitest';

import { isHeterogeneousSandboxExecutionAvailable } from './executionTarget';

describe('isHeterogeneousSandboxExecutionAvailable', () => {
  it('falls back to the built-in list when the deployment published nothing', () => {
    expect(isHeterogeneousSandboxExecutionAvailable('claude-code')).toBe(true);
    expect(isHeterogeneousSandboxExecutionAvailable('opencode')).toBe(false);
  });

  it('treats an empty published list as "nothing published"', () => {
    expect(isHeterogeneousSandboxExecutionAvailable('claude-code', [])).toBe(true);
  });

  it('defers to the deployment when it published a list', () => {
    expect(isHeterogeneousSandboxExecutionAvailable('opencode', ['opencode'])).toBe(true);
  });

  it('lets the deployment exclude a type the built-in list would allow', () => {
    // The server gates dispatch on the same list, so the client must not offer
    // the sandbox for a type that deployment would refuse to run.
    expect(isHeterogeneousSandboxExecutionAvailable('claude-code', ['opencode'])).toBe(false);
  });

  it('is false for an unknown or missing type either way', () => {
    expect(isHeterogeneousSandboxExecutionAvailable(undefined, ['opencode'])).toBe(false);
    expect(isHeterogeneousSandboxExecutionAvailable('nope', ['opencode'])).toBe(false);
  });
});
