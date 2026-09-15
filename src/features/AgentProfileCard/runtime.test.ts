import { describe, expect, it } from 'vitest';

import { resolveAgentRuntime } from './runtime';

describe('resolveAgentRuntime', () => {
  it('names the external runtime of a Claude Code agent from the home agent list', () => {
    // The card used to show the LobeHub model for a Claude Code agent, which is
    // not what runs it, and gave no hint it was an external agent at all.
    expect(
      resolveAgentRuntime({ isFetched: false, listEntry: { heterogeneousType: 'claude-code' } }),
    ).toEqual({ heterogeneousLabel: 'Claude Code', known: true });
  });

  it('falls back to the fetched config for an agent outside the home list', () => {
    expect(resolveAgentRuntime({ fetchedType: 'claude-code', isFetched: true })).toEqual({
      heterogeneousLabel: 'Claude Code',
      known: true,
    });
  });

  it('marks a listed agent without an external runtime as built-in', () => {
    expect(
      resolveAgentRuntime({ isFetched: false, listEntry: { heterogeneousType: null } }),
    ).toEqual({ heterogeneousLabel: undefined, known: true });
  });

  it('does not guess before anything has said which kind of agent it is', () => {
    expect(resolveAgentRuntime({ isFetched: false })).toEqual({
      heterogeneousLabel: undefined,
      known: false,
    });
  });
});
