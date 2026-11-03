import { describe, expect, it } from 'vitest';

import { ownDifferences, rootCausesOf } from './diff';

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
