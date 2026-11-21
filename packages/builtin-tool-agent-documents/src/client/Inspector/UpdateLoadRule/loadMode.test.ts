import { describe, expect, it } from 'vitest';

import { resolveInspectorLoadMode } from './loadMode';

describe('resolveInspectorLoadMode', () => {
  it('names the stored mode once the call has settled', () => {
    expect(
      resolveInspectorLoadMode({
        args: { id: 'a', rule: { maxTokens: 900 } },
        pluginState: { applied: true, policyLoad: 'progressive', rule: { maxTokens: 900 } },
      }),
    ).toBe('progressive');
  });

  it('prefers the stored mode over the requested one', () => {
    expect(
      resolveInspectorLoadMode({
        args: { id: 'a', rule: { mode: 'always' } },
        pluginState: { applied: true, policyLoad: 'always', rule: { mode: 'always' } },
      }),
    ).toBe('always');
  });

  it('shows the requested mode while the call runs', () => {
    expect(
      resolveInspectorLoadMode({ inFlight: true, partialArgs: { rule: { mode: 'always' } } }),
    ).toBe('always');
  });

  // A refused call (e.g. a folder) stores nothing; naming the requested
  // "always" would claim a load mode that was never applied.
  it('names no mode for a settled call without a stored mode', () => {
    expect(
      resolveInspectorLoadMode({ args: { id: 'folder', rule: { mode: 'always' } } }),
    ).toBeUndefined();
  });
});
