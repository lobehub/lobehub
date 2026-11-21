import { describe, expect, it } from 'vitest';

import type { CaseSnapshot } from './api';
import { propertyRows } from './properties';

const target = (values: Record<string, string>) => ({
  box: [],
  key: 'root.0',
  tag: 'SPAN',
  values,
});

const snapshot: CaseSnapshot = {
  base: {
    target: target({
      'border-top-color': 'black',
      'color': 'rgb(0, 0, 0)',
      'cursor': 'auto',
      'width': '8px',
    }),
    targetKey: 'root.0',
  },
  differences: [
    { after: 'rgb(255, 0, 0)', before: 'rgb(0, 0, 0)', key: 'root.0', property: 'color' },
    { after: '2px', before: '1px', key: 'root.0.1', property: 'width' },
  ],
  head: {
    target: target({
      'border-top-color': 'red',
      'color': 'rgb(255, 0, 0)',
      'cursor': 'auto',
      'width': '8px',
    }),
    targetKey: 'root.0',
  },
  ignored: [{ key: 'root.0', property: 'border-top-color', reason: 'nonpainting border color' }],
};

const declared = ['border-top-color', 'color', 'width'];

describe('propertyRows', () => {
  it("marks only the target element's differences and shows ignored ones with their reason", () => {
    expect(propertyRows(snapshot, declared, 'declared')).toEqual([
      {
        base: 'black',
        head: 'red',
        mark: 'ignored',
        name: 'border-top-color',
        reason: 'nonpainting border color',
      },
      { base: 'rgb(0, 0, 0)', head: 'rgb(255, 0, 0)', mark: 'different', name: 'color' },
      { base: '8px', head: '8px', mark: 'same', name: 'width' },
    ]);
  });

  it('lists every computed property or only the differing ones', () => {
    expect(propertyRows(snapshot, declared, 'all').map((row) => row.name)).toEqual([
      'border-top-color',
      'color',
      'cursor',
      'width',
    ]);
    expect(propertyRows(snapshot, declared, 'diff').map((row) => row.name)).toEqual(['color']);
  });
});
