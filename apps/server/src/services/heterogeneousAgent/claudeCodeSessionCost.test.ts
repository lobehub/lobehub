import { describe, expect, it } from 'vitest';

import { claudeCodeRunCostCap, resolveClaudeCodeRunCost } from './claudeCodeSessionCost';

describe('resolveClaudeCodeRunCost', () => {
  it('books only the delta when the reported cost exceeds what the tokens can cost', () => {
    // tpc_rRM9YUxTAo2s: a 1-step op with 470k input tokens reported $139.60
    // right after an op that reported $137.00 for the same session.
    expect(claudeCodeRunCostCap(470_000, 2000)).toBeCloseTo(4.8);
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 470_000,
        outputTokens: 2000,
        previous: { reportedCost: 137 },
        provider: 'claude-code',
        reportedCost: 139.6,
      }),
    ).toEqual({ reportedSessionTotal: 139.6, total: 2.6 });
  });

  it('keeps de-cumulating a session whose report is still above the cap', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 470_000,
        outputTokens: 2000,
        // cap = 4.8; the session total is far above it, so the next hop is read the
        // same way even though its own report moved by less than the cap.
        previous: { reportedCost: 139.6 },
        provider: 'claude-code',
        reportedCost: 141.2,
      }),
    ).toEqual({ reportedSessionTotal: 141.2, total: 1.6 });
  });

  it('stops treating a value as a session total once it can be a per-run cost', () => {
    // A legacy client reported a $0.90 session total (below the $1.05 cap for these
    // tokens). The next report is $1.00: that delta would look like a continuation,
    // but a value under the cap is indistinguishable from an honest per-run cost,
    // and a topic that switches to an upgraded client has exactly this shape.
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 100_000,
        outputTokens: 1000,
        previous: { reportedCost: 0.9 },
        provider: 'claude-code',
        reportedCost: 1,
      }),
    ).toEqual({ total: 1 });
  });

  it('leaves an upgraded client per-run value alone after a small session total', () => {
    // tpc upgrade: the previous op reported a $0.09 session total. The upgraded
    // client's honest per-run value of $0.10 passes every guard except the cap one,
    // so it must be booked whole instead of as a $0.01 delta.
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 100_000,
        outputTokens: 1000,
        previous: { reportedCost: 0.09 },
        provider: 'claude-code',
        reportedCost: 0.1,
      }),
    ).toEqual({ total: 0.1 });
  });

  it('rounds the delta to the total_cost column scale', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 50_000,
        outputTokens: 500,
        previous: { reportedCost: 113.8 },
        provider: 'claude-code',
        reportedCost: 113.88,
      }).total,
    ).toBe(0.08);
  });

  it('leaves an increasing per-run cost from a new client untouched', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 300_000,
        outputTokens: 5000,
        previous: { reportedCost: 0.14 },
        provider: 'claude-code',
        reportedCost: 0.35,
      }),
    ).toEqual({ total: 0.35 });
  });

  it('leaves a session reset (cost below the previous report) untouched', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 10_000,
        outputTokens: 100,
        previous: { reportedCost: 120 },
        provider: 'claude-code',
        reportedCost: 3,
      }),
    ).toEqual({ total: 3 });
  });

  it('leaves a jump larger than the cap untouched', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 10_000,
        outputTokens: 100,
        previous: { reportedCost: 10 },
        provider: 'claude-code',
        reportedCost: 50,
      }),
    ).toEqual({ total: 50 });
  });

  it('leaves the cost untouched without a previous op', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 1000,
        outputTokens: 10,
        previous: undefined,
        provider: 'claude-code',
        reportedCost: 80,
      }),
    ).toEqual({ total: 80 });
  });

  it('leaves other providers untouched', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 1000,
        outputTokens: 10,
        previous: { reportedCost: 79 },
        provider: 'codex',
        reportedCost: 80,
      }),
    ).toEqual({ total: 80 });
  });
});
