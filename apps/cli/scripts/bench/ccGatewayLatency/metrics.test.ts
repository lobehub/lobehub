import { describe, expect, it } from 'vitest';

import {
  checkBudgets,
  deriveTurnMetrics,
  isOutputEvent,
  percentile,
  summarize,
  summarizeScenario,
  type TurnRecord,
} from './metrics';

const turn = (partial: Partial<TurnRecord>): TurnRecord => ({
  events: [],
  marks: {},
  scenario: 'hello',
  ...partial,
});

describe('isOutputEvent', () => {
  it('counts visible content and tool activity', () => {
    expect(isOutputEvent({ at: 0, detail: 'text', type: 'stream_chunk' })).toBe(true);
    expect(isOutputEvent({ at: 0, detail: 'reasoning', type: 'stream_chunk' })).toBe(true);
    expect(isOutputEvent({ at: 0, detail: 'tools_calling', type: 'stream_chunk' })).toBe(true);
    expect(isOutputEvent({ at: 0, type: 'tool_start' })).toBe(true);
    expect(isOutputEvent({ at: 0, type: 'tool_end' })).toBe(true);
  });

  it('ignores bookkeeping frames', () => {
    expect(isOutputEvent({ at: 0, type: 'stream_start' })).toBe(false);
    expect(isOutputEvent({ at: 0, detail: 'permission_mode', type: 'step_complete' })).toBe(false);
    expect(isOutputEvent({ at: 0, detail: 'other', type: 'stream_chunk' })).toBe(false);
  });
});

describe('deriveTurnMetrics', () => {
  it('splits a hello turn into dispatch, device, output and end', () => {
    const metrics = deriveTurnMetrics(
      turn({
        events: [
          { at: 1700, type: 'agent_runtime_init' },
          { at: 5400, detail: 'permission_mode', type: 'step_complete' },
          { at: 5420, type: 'stream_start' },
          { at: 9300, detail: 'text', type: 'stream_chunk' },
          { at: 9500, type: 'visible_output_end' },
          { at: 12_700, type: 'agent_runtime_end' },
        ],
        marks: { ack: 1300 },
      }),
    );

    expect(metrics).toEqual({
      ack: 1300,
      approvalCard: undefined,
      approvalEvent: undefined,
      deviceFirstEvent: 5400,
      end: 12_700,
      firstOutput: 9300,
      init: 1700,
      visibleEnd: 9500,
    });
  });

  it('measures the next output after the approval click, skipping the echo patch', () => {
    const metrics = deriveTurnMetrics(
      turn({
        events: [
          { at: 10_300, detail: 'tools_calling', type: 'stream_chunk' },
          { at: 10_340, type: 'agent_intervention_request' },
          { at: 11_400, type: 'agent_intervention_response' },
          { at: 11_450, type: 'message_patch' },
          { at: 13_900, type: 'tool_end' },
        ],
        marks: { approvalCard: 10_760, resolveSent: 10_760 },
        scenario: 'approve',
      }),
    );

    expect(metrics.approvalEvent).toBe(10_340);
    expect(metrics.approvalCard).toBe(10_760);
    expect(metrics.nextOutputAfterResolve).toBe(13_900 - 10_760);
  });

  it('leaves the resolve metric out when the turn never asked', () => {
    expect(deriveTurnMetrics(turn({})).nextOutputAfterResolve).toBeUndefined();
  });
});

describe('percentile and summaries', () => {
  it('uses nearest rank', () => {
    expect(percentile([], 50)).toBeUndefined();
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it('summarizes each metric over the turns that have it', () => {
    expect(summarize([3, 1, 2])).toEqual({ max: 3, min: 1, n: 3, p50: 2, p90: 3 });
    const summary = summarizeScenario([{ firstOutput: 100 }, { firstOutput: 300, init: 50 }]);
    expect(summary.firstOutput).toMatchObject({ n: 2, p50: 100 });
    expect(summary.init).toMatchObject({ n: 1, p50: 50 });
  });
});

describe('checkBudgets', () => {
  it('reports only p50 values over their ceiling', () => {
    const violations = checkBudgets(
      {
        hello: {
          firstOutput: { max: 0, min: 0, n: 3, p50: 9000, p90: 9500 },
          init: { max: 0, min: 0, n: 3, p50: 1000, p90: 4000 },
        },
      },
      { hello: { firstOutput: 8000, init: 2000 }, image: { firstOutput: 1 } },
      3,
    );

    expect(violations).toEqual([
      { actual: 9000, budget: 8000, metric: 'firstOutput', samples: 3, scenario: 'hello' },
    ]);
  });

  it('fails a budgeted metric that some turns never produced', () => {
    const violations = checkBudgets(
      {
        approve: { ack: { max: 0, min: 0, n: 3, p50: 1500, p90: 1600 } },
        hello: { firstOutput: { max: 0, min: 0, n: 1, p50: 5000, p90: 5000 } },
      },
      { approve: { ack: 3000, approvalEvent: 13_000 }, hello: { firstOutput: 11_000 } },
      3,
    );

    expect(violations).toEqual([
      {
        actual: undefined,
        budget: 13_000,
        metric: 'approvalEvent',
        samples: 0,
        scenario: 'approve',
      },
      { actual: 5000, budget: 11_000, metric: 'firstOutput', samples: 1, scenario: 'hello' },
    ]);
  });
});
