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
        previous: { reportedCost: 137, reportedCumulative: false },
        provider: 'claude-code',
        reportedCost: 139.6,
      }),
    ).toEqual({ reportedSessionTotal: 139.6, total: 2.6 });
  });

  it('continues a de-cumulated chain even when the value is below the cap', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 100_000,
        outputTokens: 1000,
        // cap = 1.05; 1.0 alone would pass as a per-run cost
        previous: { reportedCost: 0.9, reportedCumulative: true },
        provider: 'claude-code',
        reportedCost: 1,
      }),
    ).toEqual({ reportedSessionTotal: 1, total: 0.1 });
  });

  it('rounds the delta to the total_cost column scale', () => {
    expect(
      resolveClaudeCodeRunCost({
        inputTokens: 50_000,
        outputTokens: 500,
        previous: { reportedCost: 113.8, reportedCumulative: true },
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
        previous: { reportedCost: 0.14, reportedCumulative: false },
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
        previous: { reportedCost: 120, reportedCumulative: true },
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
        previous: { reportedCost: 10, reportedCumulative: true },
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
        previous: { reportedCost: 79, reportedCumulative: true },
        provider: 'codex',
        reportedCost: 80,
      }),
    ).toEqual({ total: 80 });
  });
});
