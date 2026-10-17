import { describe, expect, it } from 'vitest';

import curveInput from '../../examples/native-curve-explorer.json';
import planInput from '../../examples/native-plan-comparison.json';
import {
  createNativeUIState,
  evaluateNativeExpression,
  sampleNativeChart,
  updateNativeUIState,
} from './engine';
import { NativeUIDocumentSchema } from './schema';
import type { NativeUIChartNode, NativeUIExpression, NativeUIState } from './types';

const plan = NativeUIDocumentSchema.parse(planInput);
const curve = NativeUIDocumentSchema.parse(curveInput);
const chart = plan.body.find((node) => node.type === 'chart') as NativeUIChartNode;
const derived = (key: string, state: NativeUIState) =>
  evaluateNativeExpression({ ref: `derived.${key}` }, plan, state);
const evaluate = (expression: NativeUIExpression) =>
  evaluateNativeExpression(expression, plan, createNativeUIState(plan));

describe('native shared state and expressions', () => {
  it('synchronizes prices and recommendations at 500 and 1000 without changing the chosen plan', () => {
    const initial = createNativeUIState(plan);
    expect(['costA', 'costB', 'costC'].map((key) => derived(key, initial))).toEqual([60, 50, 65]);
    expect(derived('recommendation', initial)).toBe('Plan B is lowest at $50.00 per month.');
    const next = updateNativeUIState(plan, initial, 'quantity', 1000);
    expect(['costA', 'costB', 'costC'].map((key) => derived(key, next))).toEqual([120, 80, 80]);
    expect(derived('recommendation', next)).toBe('Plans B and C tie at $80.00 per month.');
    expect(next.plan).toBe('B');
    expect(initial.quantity).toBe(500);
    const selected = updateNativeUIState(plan, next, 'plan', 'A');
    expect(derived('selectedCost', selected)).toBe(120);
    const action = plan.body.find((node) => node.type === 'action');
    expect(action?.type).toBe('action');
    if (action?.type === 'action')
      expect(evaluateNativeExpression(action.text, plan, selected)).toContain(
        'quantity 1000 and plan A at $120.00',
      );
  });

  it('restores declared values only and resets invalid persisted data to safe defaults', () => {
    expect(createNativeUIState(plan, { quantity: 1000, plan: 'C', html: '<script>' })).toEqual({
      quantity: 1000,
      plan: 'C',
    });
    expect(createNativeUIState(plan, { quantity: NaN, plan: 'unknown' })).toEqual({
      quantity: 500,
      plan: 'B',
    });
    expect(createNativeUIState(plan, { quantity: Infinity, plan: {} })).toEqual({
      quantity: 500,
      plan: 'B',
    });
    expect(createNativeUIState(plan, ['wrong'])).toEqual(createNativeUIState(plan));
    expect(createNativeUIState(plan, { quantity: 20_000 })).toEqual({ quantity: 1500, plan: 'B' });
    expect(createNativeUIState(plan, Object.create({ quantity: 1000 }))).toEqual(
      createNativeUIState(plan),
    );
  });

  it('clamps and snaps numeric changes and ignores invalid or unknown updates', () => {
    const state = createNativeUIState(plan);
    expect(updateNativeUIState(plan, state, 'quantity', 994).quantity).toBe(990);
    expect(updateNativeUIState(plan, state, 'quantity', -5).quantity).toBe(0);
    expect(updateNativeUIState(plan, state, 'quantity', 2000).quantity).toBe(1500);
    for (const bad of ['1000', null, NaN, Infinity, {}, true])
      expect(updateNativeUIState(plan, state, 'quantity', bad)).toBe(state);
    expect(updateNativeUIState(plan, state, 'unknown', 10)).toBe(state);
    expect(updateNativeUIState(plan, state, '__proto__', 'bad')).toBe(state);
    expect(updateNativeUIState(plan, state, 'plan', 'D')).toBe(state);
    expect(updateNativeUIState(plan, state, 'quantity', 500)).toBe(state);
  });

  it('returns safe empty results for invalid math, types, traversal, and missing x', () => {
    for (const expression of [
      { op: 'divide', args: [1, 0] },
      { op: 'multiply', args: [1e12, 1e12] },
      { op: 'add', args: [1, '2'] },
      { op: 'format', args: [1, 100] },
      { op: 'format', args: [1, -1] },
      { op: 'format', args: [1, 1.5] },
      { ref: 'state.quantity.constructor' },
      { ref: 'state.missing' },
      { ref: 'x' },
    ] satisfies NativeUIExpression[])
      expect(evaluate(expression)).toBeNull();
    expect(evaluate({ op: 'if', args: [true, 7, { op: 'divide', args: [1, 0] }] })).toBe(7);
    expect(evaluate({ op: 'if', args: ['true', 7, 0] })).toBeNull();
  });

  it('preserves false and zero in declared boolean and number state', () => {
    const document = NativeUIDocumentSchema.parse({
      ...plan,
      body: [{ type: 'text', id: 'value', content: { ref: 'state.enabled' } }],
      derived: {},
      state: {
        enabled: { type: 'boolean', initial: true },
        count: { type: 'number', initial: 5, min: 0, max: 10 },
      },
    });
    const restored = createNativeUIState(document, { enabled: false, count: 0 });
    expect(restored).toEqual({ enabled: false, count: 0 });
    expect(evaluateNativeExpression({ ref: 'state.enabled' }, document, restored)).toBe(false);
    expect(updateNativeUIState(document, restored, 'enabled', 'false')).toBe(restored);
  });

  it('evaluates the closed arithmetic and formatting operators', () => {
    expect(evaluate({ op: 'add', args: [1, 2, 3] })).toBe(6);
    expect(evaluate({ op: 'subtract', args: [5, 3] })).toBe(2);
    expect(evaluate({ op: 'multiply', args: [2, 3, 4] })).toBe(24);
    expect(evaluate({ op: 'divide', args: [6, 2] })).toBe(3);
    expect(evaluate({ op: 'min', args: [6, 2] })).toBe(2);
    expect(evaluate({ op: 'max', args: [6, 2] })).toBe(6);
    expect(evaluate({ op: 'less', args: [2, 6] })).toBe(true);
    expect(evaluate({ op: 'greater', args: [2, 6] })).toBe(false);
    expect(evaluate({ op: 'equal', args: [2, '2'] })).toBe(false);
    expect(evaluate({ op: 'round', args: [1.2345, 2] })).toBe(1.23);
    expect(evaluate({ op: 'format', args: [1.2, 2] })).toBe('1.20');
    expect(evaluate({ op: 'concat', args: ['Value ', 12, ' ', true] })).toBe('Value 12 true');
  });
});

describe('native chart sampling', () => {
  it('returns uniform curve samples and exact current-marker values for every series', () => {
    const initial = sampleNativeChart(chart, plan, createNativeUIState(plan));
    expect(initial.data).toHaveLength(61);
    expect(initial.data[0]).toEqual({ x: 0, A: 0, B: 20, C: 50 });
    expect(initial.data[60]).toEqual({ x: 1500, A: 180, B: 110, C: 95 });
    expect(initial.currentX).toBe(500);
    expect(initial.currentValues).toEqual({ A: 60, B: 50, C: 65 });
    const next = sampleNativeChart(
      chart,
      plan,
      updateNativeUIState(plan, createNativeUIState(plan), 'quantity', 1000),
    );
    expect(next.currentValues).toEqual({ A: 120, B: 80, C: 80 });
    expect(next.data).toEqual(initial.data);
  });

  it('supports a different curve and contextual derived values with state-dependent shape', () => {
    const curveChart = curve.body.find((node) => node.type === 'chart') as NativeUIChartNode;
    let state = createNativeUIState(curve);
    const initial = sampleNativeChart(curveChart, curve, state);
    expect(initial.currentValues).toEqual({ quadratic: 4 });
    expect(initial.data[0].quadratic).toBe(25);
    state = updateNativeUIState(curve, state, 'scale', -2);
    state = updateNativeUIState(curve, state, 'offset', 3);
    const next = sampleNativeChart(curveChart, curve, state);
    expect(next.currentValues).toEqual({ quadratic: -5 });
    expect(next.data[0].quadratic).toBe(-47);
    expect(evaluateNativeExpression({ ref: 'derived.currentY' }, curve, state)).toBe(-5);
  });

  it('keeps discontinuities null and omits out-of-range cursors', () => {
    const reciprocal: NativeUIChartNode = {
      ...chart,
      currentX: 20,
      x: { min: -1, max: 1, samples: 3 },
      series: [{ id: 'reciprocal', label: '1/x', y: { op: 'divide', args: [1, { ref: 'x' }] } }],
    };
    const sampled = sampleNativeChart(reciprocal, plan, createNativeUIState(plan));
    expect(sampled.data.map((point) => point.reciprocal)).toEqual([-1, null, 1]);
    expect(sampled.currentX).toBeNull();
    expect(sampled.currentValues).toEqual({});
  });
});
