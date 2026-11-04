import { describe, expect, it } from 'vitest';

import { declarationBlocks, parseDeclarations } from './declarations';

const emotion = `chip: css\`
    overflow: hidden;
    padding-block: 2px;
    padding-inline: 8px;
    color: \${cssVar.colorTextSecondary};
    background: \${cssVar.colorFillTertiary};

    &:not(:last-child) {
      border-block-end: 1px solid \${cssVar.colorBorderSecondary};
    }
  \``;

const stylex = `chip: {
    overflow: 'hidden',
    paddingBlock: '2px',
    paddingInline: '8px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'solid' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
    fontSize: 12,
  }`;

describe('parseDeclarations', () => {
  it('reads an emotion block with tokens and nested selectors', () => {
    expect(parseDeclarations(emotion)).toEqual([
      { property: 'overflow', selector: '', value: 'hidden' },
      { property: 'padding-block', selector: '', value: '2px' },
      { property: 'padding-inline', selector: '', value: '8px' },
      { property: 'color', selector: '', value: 'colorTextSecondary' },
      { property: 'background', selector: '', value: 'colorFillTertiary' },
      {
        property: 'border-block-end',
        selector: ':not(:last-child)',
        value: '1px solid colorBorderSecondary',
      },
    ]);
  });

  it('reads a stylex object with conditional values', () => {
    const rows = parseDeclarations(stylex);
    expect(rows).toContainEqual({ property: 'background-image', selector: '', value: 'none' });
    expect(rows).toContainEqual({ property: 'font-size', selector: '', value: '12' });
    expect(rows).toContainEqual({
      property: 'border-block-end-color',
      selector: ':not(:last-child)',
      value: 'colorBorderSecondary',
    });
    expect(
      rows.some((row) => row.property === 'border-block-end-width' && row.selector === ''),
    ).toBe(false);
  });

  it('keeps a composed style that stands alone on a line', () => {
    const text =
      'root: css`\n    /* note */\n    ${groupStyles.shiny}\n\n    overflow: hidden;\n  `';
    expect(parseDeclarations(text)).toEqual([
      { property: 'composes', selector: '', value: 'groupStyles.shiny' },
      { property: 'overflow', selector: '', value: 'hidden' },
    ]);
  });

  it('returns nothing instead of throwing on broken css', () => {
    expect(parseDeclarations('root: css`\n    color: red;;; {{\n  `')).toEqual([]);
  });

  it('returns nothing for text it cannot read', () => {
    expect(parseDeclarations('chip: someHelper()')).toEqual([]);
  });
});

describe('declarationBlocks', () => {
  it('aligns both sides by property family per style block and marks differing families', () => {
    const [block] = declarationBlocks({ 'styles.chip': emotion }, { 'styles.chip': stylex }, [
      'border-block-end-color',
    ]);
    expect(block.slot).toBe('chip');
    const background = block.rows.find((row) => row.label === 'background');
    expect(background).toMatchObject({
      after: ['background-color: colorFillTertiary', 'background-image: none'],
      before: ['background: colorFillTertiary'],
      differs: false,
    });
    const border = block.rows.find((row) => row.label === ':not(:last-child) border');
    expect(border?.differs).toBe(true);
    expect(block.rows.find((row) => row.label === 'font-size')).toMatchObject({
      after: ['font-size: 12'],
      before: [],
    });
  });
});
