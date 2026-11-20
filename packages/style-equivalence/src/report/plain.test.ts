import { describe, expect, it } from 'vitest';

import { askSentence, comboLabel, differenceSummary } from './plain';

const cause = (property: string, before: string, after: string) => ({
  after,
  before,
  key: 'root.0',
  property,
});

describe('differenceSummary', () => {
  it('describes a border that appeared in one line', () => {
    const lines = differenceSummary([
      cause('border-block-end-color', 'rgb(102, 102, 102)', 'rgb(176, 176, 176)'),
      cause('border-block-end-style', 'none', 'solid'),
      cause('border-block-end-width', '0px', '1px'),
      cause('border-top-style', 'none', 'solid'),
    ]);
    expect(lines).toEqual(['边框 无 → 1px solid rgb(176, 176, 176)']);
  });

  it('names a text colour change', () => {
    expect(differenceSummary([cause('color', 'rgb(102, 102, 102)', 'rgb(138, 138, 138)')])).toEqual(
      ['文字颜色 rgb(102, 102, 102) → rgb(138, 138, 138)'],
    );
  });

  it('shows two families and counts the rest', () => {
    const lines = differenceSummary([
      cause('color', 'a', 'b'),
      cause('padding-top', '0px', '8px'),
      cause('font-feature-settings', '"tnum"', 'normal'),
      cause('box-shadow', 'none', '0 0 1px red'),
      cause('animation-duration', '0s', '1s'),
    ]);
    expect(lines).toEqual(['文字颜色 a → b', '间距 0px → 8px', '另有 3 处']);
  });

  it('describes a missing element', () => {
    expect(differenceSummary([cause('node', 'DIV', 'undefined')])).toEqual(['元素 DIV → 不存在']);
  });
});

describe('comboLabel', () => {
  it('turns booleans into 是 / 否', () => {
    expect(comboLabel({ device: true })).toBe('device：是');
    expect(comboLabel({ active: false, open: true })).toBe('active：否 · open：是');
    expect(comboLabel({})).toBe('默认');
  });

  it('shows a table key as it is', () => {
    expect(comboLabel({ kind: 'added', open: false })).toBe('kind：added · open：否');
  });
});

describe('askSentence', () => {
  it('asks about each value of an unmodeled variable', () => {
    expect(
      askSentence(
        { category: 'needs-signoff', flags: ['VARIABLE_UNMODELED'] },
        { variables: ['device'] },
      ),
    ).toContain('取决于 device');
  });

  it('names the component and prop for placement', () => {
    expect(
      askSentence(
        { category: 'needs-signoff', flags: ['PLACEMENT_SUBSTITUTED'] },
        { component: 'SkillsIcon', prop: 'className', variables: [] },
      ),
    ).toContain('交给 SkillsIcon 的 className');
  });

  it('explains a difference and a blocking item plainly', () => {
    expect(askSentence({ category: 'difference', flags: [] }, { variables: [] })).toContain(
      '不一样',
    );
    expect(askSentence({ category: 'blocking', flags: [] }, { variables: [] })).toContain('出错');
  });

  it('asks whether a runtime style was lost on purpose', () => {
    const text = askSentence(
      { category: 'needs-signoff', flags: ['RUNTIME_STYLE_DROPPED'] },
      { variables: [] },
    );
    expect(text).toContain('style=');
    expect(text).not.toContain('拿不准');
  });

  it('says which components a partly forwarded rule may still reach', () => {
    const text = askSentence(
      {
        category: 'needs-signoff',
        flags: ['INNER_TARGET', 'INNER_TARGET_PARTLY_FORWARDED:h1|AcceptanceGoal,ReadChecks'],
      },
      { variables: [] },
    );
    expect(text).toContain('AcceptanceGoal、ReadChecks');
    expect(text).toContain('h1');
    expect(text).not.toMatch(/[A-Z]{3,}_[A-Z]/);
  });

  it('names a caller of a forwarded prop that was not compared', () => {
    const text = askSentence(
      { category: 'needs-signoff', flags: ['FORWARDED_CALLER_UNCHECKED:src/Other.tsx'] },
      { variables: [] },
    );
    expect(text).toContain('src/Other.tsx');
  });

  it('never prints flag codes', () => {
    const text = askSentence(
      { category: 'needs-signoff', flags: ['CROSS_COMPONENT', 'MEDIA_UNMODELED'] },
      { variables: [] },
    );
    expect(text).not.toMatch(/[A-Z]{3,}_[A-Z]/);
  });
});
