import { describe, expect, it } from 'vitest';

import { convertCss, expandShorthand, isShorthandOf, UnsupportedCssError } from './css';

const names = { cssVar: new Set(['cssVar', 'cv']), responsive: new Set(['responsive']) };

/**
 * Builds a CssTemplate from a template literal, like the transform does. Not
 * named `block`: stylelint --fix would reorder the fixtures' declarations.
 */
const block = (strings: TemplateStringsArray, ...expressions: string[]) =>
  convertCss({ expressions, quasis: [...strings.raw] }, names);

const object = (code: string) =>
  new Function('cssVar', 'media', `return (${code});`)(
    new Proxy({}, { get: (_t, k) => `cssVar.${String(k)}` }),
    new Proxy({}, { get: (_t, k) => `media.${String(k)}` }),
  );

describe('convertCss', () => {
  it('converts declarations, tokens and numeric values', () => {
    const result = block`
      --local-size: 12px;

      display: flex;
      -webkit-line-clamp: 2;

      font-weight: 500;
      line-height: 1.2;
      color: ${'cssVar.colorText'};

      box-shadow: 0 0 0 1px ${'cv.colorBorder'};
    `;

    expect(result).toMatchObject({ usesCssVar: true, usesMedia: false });
    expect(object(result.code)).toEqual({
      '--local-size': '12px',
      'WebkitLineClamp': '2',
      'boxShadow': '0 0 0 1px cssVar.colorBorder',
      'color': 'cssVar.colorText',
      'display': 'flex',
      'fontWeight': 500,
      'lineHeight': 1.2,
    });
  });

  it('nests pseudo-classes and media queries as conditions', () => {
    const result = block`
      color: red;

      &:hover {
        color: blue;
      }
      ${'responsive.md'} {
        gap: 8px;
      }
      ${'responsive.sm'} {
        gap: 4px;
      }

      @container (max-width: 300px) {
        &:hover {
          color: green;
        }
      }
    `;

    expect(result.usesMedia).toBe(true);
    expect(object(result.code)).toEqual({
      color: {
        '@container (max-width: 300px)': { ':hover': 'green', 'default': null },
        ':hover': 'blue',
        'default': 'red',
      },
      gap: { 'default': null, 'media.md': '8px', 'media.sm': '4px' },
    });
  });

  it('moves one pseudo-element into its own style object', () => {
    const result = block`
      position: relative;

      &::after {
        content: '';
        inset: 0;
      }
    `;
    expect(object(result.code)).toEqual({
      '::after': { content: "''", inset: '0' },
      'position': 'relative',
    });
  });

  it('keeps references to module constants for the StyleX compiler', () => {
    expect(
      object(
        block`
          width: ${'AVATAR_SIZE'}px;
        `.code.replace('AVATAR_SIZE', '40'),
      ),
    ).toEqual({
      width: '40px',
    });
  });

  it.each<[string, () => unknown]>([
    [
      '!important',
      () => block`
        color: red !important;
      `,
    ],
    [
      'descendant selector',
      () => block`
        & .child {
          color: red;
        }
      `,
    ],
    [
      'attribute selector',
      () => block`
        &[data-open] {
          color: red;
        }
      `,
    ],
    [
      'keyframes',
      () => block`
        @keyframes spin {
          from {
            opacity: 0;
          }
        }
      `,
    ],
    [
      'call interpolation',
      () => block`
        background: ${"imageUrl('a.png')"};
      `,
    ],
    [
      'hover before disabled',
      () => block`
        &:hover {
          color: red;
        }

        &:disabled {
          color: gray;
        }
      `,
    ],
    [
      'media before hover',
      () => block`
        ${'responsive.sm'} {
          color: red;
        }

        &:hover {
          color: blue;
        }
      `,
    ],
    [
      'narrow before wide media',
      () => block`
        ${'responsive.sm'} {
          gap: 1px;
        }
        ${'responsive.md'} {
          gap: 2px;
        }
      `,
    ],
    [
      'longhand before shorthand',
      () => block`
        padding-inline: 4px;
        padding: 8px;
      `,
    ],
    [
      'shorthand in another condition',
      () => block`
        padding-inline: 4px;

        &:hover {
          padding: 8px;
        }
      `,
    ],
  ])('rejects %s', (_label, run) => {
    expect(run).toThrow(UnsupportedCssError);
  });

  it('accepts a shorthand followed by its longhand in the same block', () => {
    expect(
      object(
        block`
        padding: 8px;
        padding-inline: 4px;
      `.code,
      ),
    ).toEqual({
      padding: '8px',
      paddingInline: '4px',
    });
  });
});

describe('expandShorthand', () => {
  it.each([
    [
      'padding',
      '0 8px',
      [
        ['paddingBlock', '0'],
        ['paddingInline', '8px'],
      ],
    ],
    [
      'margin',
      '1px 2px 3px',
      [
        ['marginTop', '1px'],
        ['marginRight', '2px'],
        ['marginBottom', '3px'],
        ['marginLeft', '2px'],
      ],
    ],
    [
      'paddingInline',
      '8px 10px',
      [
        ['paddingInlineStart', '8px'],
        ['paddingInlineEnd', '10px'],
      ],
    ],
    [
      'gap',
      '4px 8px',
      [
        ['rowGap', '4px'],
        ['columnGap', '8px'],
      ],
    ],
    [
      'overflow',
      'hidden auto',
      [
        ['overflowX', 'hidden'],
        ['overflowY', 'auto'],
      ],
    ],
    [
      'flex',
      '1 1 0',
      [
        ['flexGrow', '1'],
        ['flexShrink', '1'],
        ['flexBasis', '0'],
      ],
    ],
    [
      'flex',
      '0 0 120px',
      [
        ['flexGrow', '0'],
        ['flexShrink', '0'],
        ['flexBasis', '120px'],
      ],
    ],
    [
      'border',
      '1px solid __lobeX0__',
      [
        ['borderWidth', '1px'],
        ['borderStyle', 'solid'],
        ['borderColor', '__lobeX0__'],
      ],
    ],
    ['borderBlockEnd', 'none', [['borderBlockEndStyle', 'none']]],
    [
      'borderRadius',
      '4px 8px',
      [
        ['borderTopLeftRadius', '4px'],
        ['borderTopRightRadius', '8px'],
        ['borderBottomRightRadius', '4px'],
        ['borderBottomLeftRadius', '8px'],
      ],
    ],
    [
      'background',
      'rgb(0 0 0 / 50%)',
      [
        ['backgroundColor', 'rgb(0 0 0 / 50%)'],
        ['backgroundImage', 'none'],
      ],
    ],
    [
      'background',
      '__lobeX0__',
      [
        ['backgroundColor', '__lobeX0__'],
        ['backgroundImage', 'none'],
      ],
    ],
    [
      'background',
      'inherit',
      [
        ['backgroundColor', 'inherit'],
        ['backgroundImage', 'inherit'],
      ],
    ],
    [
      'background',
      'none',
      [
        ['backgroundColor', 'transparent'],
        ['backgroundImage', 'none'],
      ],
    ],
  ])('%s: %s', (prop, value, expected) => {
    expect(expandShorthand(prop, value)).toEqual(expected);
  });

  it.each([
    ['background', 'linear-gradient(red, blue)'],
    ['background', 'url(a.png) no-repeat'],
    ['animation', 'spin 1s linear infinite'],
  ])('rejects %s: %s, which StyleX would compile to nothing', (prop, value) => {
    expect(() => expandShorthand(prop, value)).toThrow(UnsupportedCssError);
  });
});

describe('isShorthandOf', () => {
  it.each([
    ['padding', 'paddingInline', true],
    ['paddingInline', 'paddingInlineStart', true],
    ['gap', 'rowGap', true],
    ['inset', 'top', true],
    ['font', 'lineHeight', true],
    ['borderRadius', 'borderTopLeftRadius', true],
    ['border', 'borderRadius', false],
    ['paddingInline', 'padding', false],
  ])('%s → %s: %s', (short, long, expected) => {
    expect(isShorthandOf(short, long)).toBe(expected);
  });
});
