import { describe, expect, it } from 'vitest';

import curve from '../../examples/native-curve-explorer.json';
import plan from '../../examples/native-plan-comparison.json';
import { NATIVE_UI_LIMITS, NativeUIDocumentSchema, NativeUIParameters } from './schema';
import type { NativeUIExpression } from './types';

const invalid = (value: unknown) =>
  expect(NativeUIDocumentSchema.safeParse(value).success).toBe(false);

describe('native UI document validation', () => {
  it('accepts independent declarative calculators and exposes only v2 to new tools', () => {
    expect(NativeUIDocumentSchema.parse(plan).version).toBe(2);
    expect(NativeUIDocumentSchema.parse(curve).version).toBe(2);
    expect(NativeUIParameters.properties.version.enum).toEqual([2]);
    expect(JSON.stringify(NativeUIParameters)).not.toContain('$ref');
    invalid({ ...plan, version: 1 });
  });

  it('rejects source code, event handlers, external capabilities, and unknown fields', () => {
    for (const key of ['html', 'css', 'js', 'network', 'onClick'])
      invalid({ ...plan, [key]: 'fetch()' });
    invalid({
      ...plan,
      body: [{ id: 'bad', type: 'text', content: 'hello', onClick: 'doSomething' }],
    });
    invalid({
      ...plan,
      body: [{ id: 'bad', type: 'action', label: 'Run', action: 'tool', text: 'hi' }],
    });
  });

  it('validates exact references, arity, numeric ranges, and state-bound control types', () => {
    for (const ref of ['state.missing', 'state.quantity.value', 'window', 'state.__proto__', 'x']) {
      invalid({ ...plan, body: [{ id: 'bad', type: 'text', content: { ref } }] });
    }
    invalid({ ...plan, derived: { bad: { op: 'divide', args: [1] } } });
    invalid({ ...plan, state: { quantity: { type: 'number', initial: 5, min: 8, max: 2 } } });
    invalid({
      ...plan,
      state: { quantity: { type: 'number', initial: Infinity, min: 0, max: 10 } },
    });
    invalid({
      ...plan,
      state: { quantity: { type: 'number', initial: 5, min: 0, max: 10, step: 0 } },
    });
    invalid({ ...plan, body: [{ type: 'slider', id: 'bad', bind: 'plan', label: 'Plan' }] });
    invalid({ ...plan, body: [{ type: 'number', id: 'bad', bind: 'missing', label: 'Missing' }] });
    invalid({ ...plan, state: { plan: { type: 'string', initial: 'Z', options: ['A', 'B'] } } });
  });

  it('rejects duplicate identifiers and invalid or duplicate choices', () => {
    invalid({
      ...plan,
      body: [
        { id: 'same', type: 'text', content: 'one' },
        { id: 'same', type: 'text', content: 'two' },
      ],
    });
    const choice = { bind: 'plan', id: 'choice', label: 'Plan', type: 'choices' };
    invalid({
      ...plan,
      body: [
        {
          ...choice,
          options: [
            { label: 'B', value: 'B' },
            { label: 'Duplicate', value: 'B' },
          ],
        },
      ],
    });
    invalid({
      ...plan,
      body: [
        {
          ...choice,
          options: [
            { label: 'Bad', value: 'Z' },
            { label: 'B', value: 'B' },
          ],
        },
      ],
    });
    invalid({ ...plan, body: [{ ...choice, options: [{ label: 'A', value: 'A' }] }] });
    invalid({
      ...plan,
      body: [
        {
          ...choice,
          options: [
            { label: 'B', value: 'B' },
            { label: 'Number', value: 42 },
          ],
        },
      ],
    });
  });

  it('rejects derived cycles and contextual x used outside a chart', () => {
    invalid({ ...plan, derived: { a: { ref: 'derived.b' }, b: { ref: 'derived.a' } } });
    invalid({ ...curve, body: [{ id: 'bad', type: 'text', content: { ref: 'derived.curve' } }] });
    invalid({
      ...curve,
      derived: { ...curve.derived, indirect: { ref: 'derived.curve' } },
      body: [{ id: 'bad', type: 'text', content: { ref: 'derived.indirect' } }],
    });
  });

  it('bounds tree depth before recursive parsing and rejects cyclic JavaScript inputs', () => {
    let expression: NativeUIExpression = 1;
    for (let index = 0; index < 1000; index++) expression = { args: [expression, 1], op: 'add' };
    expect(() =>
      NativeUIDocumentSchema.safeParse({ ...plan, derived: { deep: expression } }),
    ).not.toThrow();
    invalid({ ...plan, derived: { deep: expression } });
    const cyclic: Record<string, unknown> = { ...plan };
    cyclic.loop = cyclic;
    invalid(cyclic);
    invalid({ ...plan, title: '你'.repeat(NATIVE_UI_LIMITS.totalBytes) });
  });

  it('bounds expression count, nodes, and chart data', () => {
    invalid({
      ...plan,
      body: Array.from({ length: 129 }, (_, index) => ({
        id: `n${index}`,
        type: 'text',
        content: 'a',
      })),
    });
    const chart = structuredClone(plan.body.find((node) => node.type === 'chart'))!;
    invalid({ ...plan, body: [{ ...chart, x: { min: 0, max: 10, samples: 100_000 } }] });
    invalid({ ...plan, body: [{ ...chart, x: { min: 10, max: 0, samples: 10 } }] });
    invalid({ ...plan, body: [{ ...chart, series: [{ id: 'x', label: 'Reserved', y: 1 }] }] });
    invalid({
      ...plan,
      body: Array.from({ length: 12 }, (_, index) => ({
        ...structuredClone(chart),
        id: `chart${index}`,
        x: { min: 0, max: 10, samples: 128 },
      })),
    });
    invalid({
      ...plan,
      derived: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`d${index}`, index])),
    });
    invalid({
      ...plan,
      body: Array.from({ length: 128 }, (_, index) => ({
        id: `expr${index}`,
        type: 'text',
        content: { op: 'concat', args: Array.from({ length: 16 }, () => 'a') },
      })),
    });
    let nested: NativeUIExpression = 1;
    for (let index = 0; index < 18; index++) nested = { op: 'add', args: [nested, 1] };
    invalid({ ...plan, derived: { nested } });
  });
});
