import { describe, expect, it } from 'vitest';

import { resolveAgentRuntimeLabel } from './runtime';

describe('resolveAgentRuntimeLabel', () => {
  it('names the external runtime of a Claude Code agent from the home agent list', () => {
    // The card used to show the LobeHub model for a Claude Code agent, which is
    // not what runs it.
    expect(resolveAgentRuntimeLabel({ listEntry: { heterogeneousType: 'claude-code' } })).toBe(
      'Claude Code',
    );
  });

  it('falls back to the fetched config for an agent outside the home list', () => {
    expect(resolveAgentRuntimeLabel({ fetchedType: 'claude-code' })).toBe('Claude Code');
  });

  it('has no runtime label for a built-in agent', () => {
    expect(resolveAgentRuntimeLabel({ listEntry: { heterogeneousType: null } })).toBeUndefined();
    expect(resolveAgentRuntimeLabel({})).toBeUndefined();
  });
});
