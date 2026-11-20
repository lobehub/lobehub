import { describe, expect, it } from 'vitest';

import {
  type CaseResult,
  confirmDifferences,
  DIFFERENCE_NOT_REPRODUCED,
  mergeRetry,
  ownDifferences,
  rootCausesOf,
} from './diff';

const diff = (property: string, before: string, after: string, key = 'root.0') => ({
  after,
  before,
  key,
  property,
});

describe('rootCausesOf', () => {
  it('folds layout side effects into the declared property that caused them', () => {
    expect(
      rootCausesOf([
        diff('width', '14px', '16px'),
        diff('inline-size', '14px', '16px'),
        diff('transform-origin', '7px 7px', '8px 7px'),
        diff('perspective-origin', '7px 7px', '8px 7px'),
        diff('box', '[0,0,14,14]', '[0,0,16,14]'),
        diff('box', '[14,0,10,14]', '[16,0,10,14]', 'root.1'),
      ]),
    ).toEqual([{ after: '16px', before: '14px', key: 'root.0', property: 'inline-size' }]);
  });

  it('folds properties that mirror color into color', () => {
    expect(
      rootCausesOf([
        diff('color', 'rgb(102, 102, 102)', 'rgb(138, 138, 138)'),
        diff('caret-color', 'rgb(102, 102, 102)', 'rgb(138, 138, 138)'),
        diff('-webkit-text-fill-color', 'rgb(102, 102, 102)', 'rgb(138, 138, 138)'),
        diff('outline-color', 'rgb(102, 102, 102)', 'rgb(138, 138, 138)'),
      ]),
    ).toEqual([diff('color', 'rgb(102, 102, 102)', 'rgb(138, 138, 138)')]);
  });

  it('keeps a mirrored color property that diverges from color', () => {
    expect(
      rootCausesOf([diff('color', 'red', 'red'), diff('outline-color', 'red', 'blue')].slice(1)),
    ).toEqual([diff('outline-color', 'red', 'blue')]);
  });

  it('keeps a geometry change that no style property explains', () => {
    expect(rootCausesOf([diff('box', '[0,0,10,10]', '[0,0,12,10]', 'root.0.0')])).toEqual([
      diff('box', '[0,0,10,10]', '[0,0,12,10]', 'root.0.0'),
    ]);
  });
});

describe('ownDifferences', () => {
  it('keeps only what happens at or under the target element', () => {
    expect(
      ownDifferences(
        [
          diff('padding-block-start', '8px', '10px', 'root.0'),
          diff('box', '[8,8,100,20]', '[8,10,100,20]', 'root.0.0'),
          diff('color', 'red', 'blue', 'root.0.0.0'),
          diff('content', 'none', '"x"', 'root.0.0::before'),
        ],
        'root.0.0',
      ),
    ).toEqual([
      diff('color', 'red', 'blue', 'root.0.0.0'),
      diff('content', 'none', '"x"', 'root.0.0::before'),
    ]);
  });

  it('keeps a size change of the target even though its position is ignored', () => {
    expect(
      ownDifferences([diff('box', '[8,8,100,20]', '[8,10,120,20]', 'root.0.0')], 'root.0.0'),
    ).toEqual([diff('box', '[8,8,100,20]', '[8,10,120,20]', 'root.0.0')]);
  });
});

const result = (overrides: Partial<CaseResult>): CaseResult => ({
  comboDifferences: [],
  differingConditions: [],
  errors: [],
  gaps: [],
  key: 'a|A#0',
  rootCauses: [],
  status: 'equal',
  unstableConditions: [],
  ...overrides,
});

describe('mergeRetry', () => {
  it('keeps a condition unstable only when the retry is unstable too, and takes the retry differences', () => {
    const cause = diff('color', 'red', 'blue');
    const merged = mergeRetry(
      result({
        differingConditions: ['light/375/default'],
        status: 'unstable',
        unstableConditions: ['light/600/force:active', 'dark/600/default'],
      }),
      result({
        comboDifferences: [
          { combo: 0, condition: 'dark/600/default', differences: [cause], rootCauses: [cause] },
        ],
        differingConditions: ['dark/600/default'],
        rootCauses: [cause],
        status: 'difference',
      }),
    );
    expect(merged).toMatchObject({
      differingConditions: ['light/375/default', 'dark/600/default'],
      rootCauses: [cause],
      status: 'difference',
      unstableConditions: [],
    });
    expect(
      mergeRetry(
        result({ status: 'unstable', unstableConditions: ['x'] }),
        result({ status: 'unstable', unstableConditions: ['x'] }),
      ).status,
    ).toBe('unstable');
  });
});

describe('mergeRetry over differing conditions', () => {
  const kept = diff('color', 'red', 'blue');
  const flake = diff('opacity', '1', '0');
  const at = (condition: string, cause: typeof kept) => ({
    combo: 0,
    condition,
    differences: [cause],
    rootCauses: [cause],
  });
  const original = result({
    comboDifferences: [at('light/375/hover-target', kept), at('dark/796/focus-visible', flake)],
    differingConditions: ['light/375/hover-target', 'dark/796/focus-visible'],
    rootCauses: [kept, flake],
    status: 'difference',
  });

  it('keeps only the differences the retry reproduces', () => {
    const merged = mergeRetry(
      original,
      result({
        comboDifferences: [at('light/375/hover-target', kept)],
        differingConditions: ['light/375/hover-target'],
        rootCauses: [kept],
        status: 'difference',
      }),
      original.differingConditions,
    );
    expect(merged).toMatchObject({
      differingConditions: ['light/375/hover-target'],
      rootCauses: [kept],
      status: 'difference',
    });
  });

  it('is equal when the retry reproduces none of them', () => {
    expect(mergeRetry(original, result({}), original.differingConditions)).toMatchObject({
      comboDifferences: [],
      differingConditions: [],
      rootCauses: [],
      status: 'equal',
    });
  });
});

describe('confirmDifferences', () => {
  const cause = diff('opacity', '1', '0');
  const seen = result({
    comboDifferences: [
      { combo: 0, condition: 'dark/796/focus-visible', differences: [cause], rootCauses: [cause] },
    ],
    differingConditions: ['dark/796/focus-visible'],
    rootCauses: [cause],
    status: 'difference',
  });

  it('keeps a difference the retry did not reproduce as a gap, so the case needs sign-off', () => {
    expect(confirmDifferences(seen, result({}), seen.differingConditions)).toMatchObject({
      differingConditions: [],
      gaps: [DIFFERENCE_NOT_REPRODUCED],
      status: 'equal',
    });
  });

  it('adds no gap when every difference reproduces', () => {
    expect(confirmDifferences(seen, seen, seen.differingConditions).gaps).toEqual([]);
  });
});
