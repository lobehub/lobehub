import { describe, expect, it } from 'vitest';

import { inventorySource } from './scopeInventory';

const slots = (source: string) =>
  inventorySource(source, 'component.tsx', 'base', 'blob').filter(
    (unit) => unit.kind === 'style-slot',
  );

describe('source style inventory', () => {
  it('uses import and syntax nodes, not commented source or CSS-shaped strings', () => {
    expect(slots('// createStyles({ hidden: {} })\nconst text = "stylex.create({})";')).toEqual([]);
    expect(inventorySource('export const x = 1', 'helper.ts', 'candidate', 'blob')[0].kind).toBe(
      'source',
    );
  });

  it('retains unmounted slots and aliased StyleX imports', () => {
    const units = slots(
      'import * as sx from "@stylexjs/stylex"; const s = sx.create({ root: {color:"red"}, neverMounted: {color:"blue"} });',
    );
    expect(units.map((unit) => unit.label)).toEqual(['sx.create', 'root', 'neverMounted']);
  });

  it('finds legacy callback styles with a renamed import', () => {
    expect(
      slots(
        'import { createStaticStyles as make } from "@lobehub/ui"; const s = make(({css}) => ({root: css`color:red;`, hidden: css`&:hover {color:blue;}`}));',
      ).map((unit) => unit.label),
    ).toEqual(['make', 'root', 'hidden']);
  });

  it('retains dynamic spreads and unknown source as unresolved units', () => {
    expect(
      slots('import sx from "@stylexjs/stylex"; sx.create({...extra});').map((unit) => unit.label),
    ).toContain('dynamic-slot');
    expect(inventorySource('opaque', 'asset.svg', 'base', 'blob')[0].kind).toBe('opaque');
  });

  it('keeps the two source sides distinguishable even when paths match', () => {
    const source = 'import {create} from "@stylexjs/stylex"; create({a:{color:"red"}});';
    expect(inventorySource(source, 'x.ts', 'base', 'blob')[0].id).not.toBe(
      inventorySource(source, 'x.ts', 'candidate', 'blob')[0].id,
    );
  });
});
