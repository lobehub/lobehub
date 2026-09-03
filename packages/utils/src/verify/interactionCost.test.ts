import { GOMS_KLM_MODEL, GOMS_KLM_TRACE_SCHEMA } from '@lobechat/const/verify';
import { describe, expect, it } from 'vitest';

import { parseKlmTrace, summarizeKlmTrace } from './interactionCost';

const atom = (overrides: Record<string, unknown> = {}) => ({
  klm: { category: 'action', operators: { K: 0, M: 0, P: 1, R_ms: 0, T_chars: 0 } },
  phase: { id: 'login', label: 'Login' },
  schema: GOMS_KLM_TRACE_SCHEMA,
  ...overrides,
});

describe('parseKlmTrace', () => {
  it('reads one atom per line and ignores blanks', () => {
    const raw = `${JSON.stringify(atom())}\n\n${JSON.stringify(atom())}\n`;

    expect(parseKlmTrace(raw)).toHaveLength(2);
  });

  it('drops a truncated line instead of failing the whole trace', () => {
    const raw = `${JSON.stringify(atom())}\n{"klm":{"operators":{"P":1`;

    expect(parseKlmTrace(raw)).toHaveLength(1);
  });
});

describe('summarizeKlmTrace', () => {
  it('prices operators with the pinned timing model', () => {
    const cost = summarizeKlmTrace([
      atom({ klm: { category: 'action', operators: { K: 1, P: 1 } } }),
      atom({ klm: { category: 'action', operators: { M: 1, R_ms: 2000 } } }),
    ]);

    // P 1.1 + K 0.2 + M 1.35 = 2.65 active, plus 2s measured wait.
    expect(cost?.activeSeconds).toBe(2.65);
    expect(cost?.waitSeconds).toBe(2);
    expect(cost?.totalSeconds).toBe(4.65);
    expect(cost?.model).toBe(GOMS_KLM_MODEL);
    expect(cost?.operators).toEqual({ H: 0, K: 1, M: 1, P: 1, R_ms: 2000, T_chars: 0 });
  });

  it('reproduces the wrapper smoke run: click + fill + wait + mental estimate', () => {
    // The exact scenario `.agents/acceptance/scripts/agent-browser-klm.test.sh`
    // records — that script now only asserts the operator counts, so the pricing
    // half of the old analyzer lives here.
    const cost = summarizeKlmTrace([
      atom({ klm: { category: 'action', operators: { K: 1, P: 1 } }, phase: { id: 'first' } }),
      atom({ klm: { category: 'action', operators: { P: 1, T_chars: 5 } }, phase: { id: 'form' } }),
      atom({ klm: { category: 'wait', operators: { R_ms: 2000 } }, phase: { id: 'wait' } }),
      atom({
        klm: { category: 'mental', operators: { M: 2 } },
        phase: { id: 'first' },
        type: 'mental_estimate',
      }),
    ]);

    expect(cost?.activeSeconds).toBe(6.1);
    expect(cost?.waitSeconds).toBe(2);
    expect(cost?.totalSeconds).toBe(8.1);
    expect(cost?.phases?.[0].id).toBe('first');
  });

  it('groups by phase and sorts the most expensive first', () => {
    const cost = summarizeKlmTrace([
      atom({ klm: { operators: { P: 1 } }, phase: { id: 'login', label: 'Login' } }),
      atom({ klm: { operators: { P: 3 } }, phase: { id: 'compose', label: 'Compose' } }),
    ]);

    expect(cost?.phases?.map((phase) => phase.id)).toEqual(['compose', 'login']);
    expect(cost?.phases?.[0].seconds).toBe(3.3);
  });

  it('files unphased atoms under one unscoped bucket', () => {
    const cost = summarizeKlmTrace([atom({ phase: undefined })]);

    expect(cost?.phases?.[0]).toMatchObject({ id: 'unscoped', label: undefined });
  });

  it('separates agent wall-clock from the user-equivalent price', () => {
    const cost = summarizeKlmTrace([atom({ durationMs: 8000, klm: { operators: { P: 1 } } })]);

    expect(cost?.actualAgentSeconds).toBe(8);
    expect(cost?.totalSeconds).toBe(1.1);
  });

  it('collects mental estimates with their phase', () => {
    const cost = summarizeKlmTrace([
      atom({
        klm: { category: 'mental', operators: { M: 2 } },
        mentalEstimate: { reason: 'first view', score: 3 },
        type: 'mental_estimate',
      }),
    ]);

    expect(cost?.mentalEstimates).toEqual([{ phaseId: 'login', reason: 'first view', score: 3 }]);
    expect(cost?.categoryCounts).toEqual({ mental: 1 });
  });

  it('returns null for an empty trace rather than a 0s measurement', () => {
    expect(summarizeKlmTrace([])).toBeNull();
  });

  it('returns null when every action was blocked', () => {
    // No agent-browser on the machine: each command fails, the wrapper charges
    // zero operators. Publishing that as a 0s cost would read as a free run.
    const blocked = atom({ klm: { category: 'blocked', operators: {} } });

    expect(summarizeKlmTrace([blocked, blocked])).toBeNull();
  });

  it('ignores atoms tagged with a foreign schema', () => {
    expect(summarizeKlmTrace([atom({ schema: 'someone.else@2' })])).toBeNull();
  });
});
