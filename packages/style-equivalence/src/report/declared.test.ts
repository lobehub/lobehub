import { describe, expect, it } from 'vitest';

import { declaredProperties } from './declared';

describe('declaredProperties', () => {
  it('reads property names from stylex objects and css templates and expands shorthands', () => {
    expect(
      declaredProperties([
        "unreadDot: { flexShrink: 0, width: '8px', backgroundColor: { default: cssVar.colorInfo, ':hover': 'red' } }",
        'label: css`\n  padding: 4px;\n  &:hover { color: red; }\n`',
      ]),
    ).toEqual([
      'background-color',
      'color',
      'flex-shrink',
      'padding-bottom',
      'padding-left',
      'padding-right',
      'padding-top',
      'width',
    ]);
  });
});
