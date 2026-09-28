import type { NodeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { mergeMeasuredSizes } from './measuredSizes';

const resize = (id: string, width: number, height: number): NodeChange => ({
  dimensions: { height, width },
  id,
  type: 'dimensions',
});

describe('mergeMeasuredSizes', () => {
  it('records the height a card actually rendered at', () => {
    expect(mergeMeasuredSizes({}, [resize('task', 260, 146.4)])).toEqual({
      task: { height: 147, width: 260 },
    });
  });

  it('returns the same object when a measurement repeats, so no relayout follows', () => {
    const previous = { task: { height: 147, width: 260 } };

    expect(mergeMeasuredSizes(previous, [resize('task', 260, 147)])).toBe(previous);
  });

  it('keeps earlier cards when another one is measured', () => {
    const next = mergeMeasuredSizes({ task: { height: 147, width: 260 } }, [
      resize('finding', 240, 76),
    ]);

    expect(next).toEqual({
      finding: { height: 76, width: 240 },
      task: { height: 147, width: 260 },
    });
  });

  it('ignores changes that are not measurements and zero-sized hidden cards', () => {
    const previous = {};

    expect(
      mergeMeasuredSizes(previous, [
        { id: 'task', selected: true, type: 'select' },
        resize('hidden', 0, 0),
      ]),
    ).toBe(previous);
  });
});
