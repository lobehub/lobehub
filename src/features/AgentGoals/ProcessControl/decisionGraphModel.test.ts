import { describe, expect, it } from 'vitest';

import { buildDecisionGraph, connectorPath, effectOfOption } from './decisionGraphModel';
import type { DecisionRow } from './decisionList';

const row = (extra: Record<string, unknown>, rowExtra: Record<string, unknown> = {}) =>
  ({
    actor: 'user',
    decision: {
      options: [
        { id: 'retry', label: 'Retry' },
        { id: 'retire', label: 'Retire' },
        { effect: 'retry', id: 'custom', label: 'Try it my way' },
      ],
      recommendedOptionId: 'retry',
      resolvedOptionId: 'retire',
      ...extra,
    },
    question: 'q',
    ...rowExtra,
  }) as unknown as DecisionRow;

const labels = [
  { id: 'retry', label: 'Retry' },
  { id: 'retire', label: 'Retire' },
  { id: 'custom', label: 'Try it my way' },
];

describe('buildDecisionGraph', () => {
  it('marks the picked option, dims the rest and sends the result out of the picked one', () => {
    const model = buildDecisionGraph(row({}, { note: 'not worth it' }), labels);

    expect(model.options.map((option) => option.state)).toEqual(['dim', 'chosen', 'dim']);
    expect(model.options[0].recommended).toBe(true);
    expect(model.result).toEqual({
      actor: 'user',
      effect: 'retire',
      from: 'option',
      note: 'not worth it',
    });
  });

  it('reads an effect from the option itself, then from the coordinator ids', () => {
    expect(effectOfOption({ effect: 'retry', id: 'custom' })).toBe('retry');
    expect(effectOfOption({ id: 'fail' })).toBe('fail');
    expect(effectOfOption({ id: 'something-else' })).toBeUndefined();
  });

  it('leaves every option open and draws no result while the question waits', () => {
    const model = buildDecisionGraph(row({ resolvedOptionId: null }, { actor: 'pending' }), labels);

    expect(model.options.every((option) => option.state === 'open')).toBe(true);
    expect(model.result).toBeUndefined();
  });

  it('hangs the result off the question when the answer was written out', () => {
    const model = buildDecisionGraph(row({ resolvedOptionId: 'gone' }, { note: 'words' }), labels);

    expect(model.options.every((option) => option.state === 'open')).toBe(true);
    expect(model.result).toMatchObject({ from: 'root', note: 'words' });
  });

  it('shows the written answer when the question was answered in free text', () => {
    const model = buildDecisionGraph(
      row({ resolvedOptionId: 'answer' }, { choice: 'ship it on Friday' }),
      [...labels, { id: 'answer', label: 'Answer with my note' }],
    );

    expect(model.options.find((option) => option.state === 'chosen')?.id).toBe('answer');
    expect(model.result).toMatchObject({ from: 'option', note: 'ship it on Friday' });
  });

  it('keeps who settled it on the result', () => {
    expect(buildDecisionGraph(row({}, { actor: 'agent' }), labels).result?.actor).toBe('agent');
  });
});

describe('connectorPath', () => {
  it('curves horizontally from one edge to the next', () => {
    expect(connectorPath({ x: 0, y: 10 }, { x: 100, y: 50 })).toBe('M 0 10 C 50 10, 50 50, 100 50');
  });

  it('keeps a minimum reach on tight gaps', () => {
    expect(connectorPath({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('M 0 0 C 24 0, -14 0, 10 0');
  });
});
