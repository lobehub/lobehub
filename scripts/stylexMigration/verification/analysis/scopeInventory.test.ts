import { describe, expect, it } from 'vitest';

import { findCssModuleResidue, inventorySource } from './scopeInventory';

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

  it('identifies CSS Modules as migration residue without matching comments or prose', () => {
    expect(
      slots(`
        import styles from './styles.module.css';
        import './legacy.module.scss?inline';
        // import ignored from './ignored.module.css';
        const prose = "import ignored from './prose.module.css'";
      `).map((unit) => unit.label),
    ).toEqual(['css-module:./styles.module.css', 'css-module:./legacy.module.scss?inline']);
  });

  it('reports candidate imports and stylesheets, not a deleted base stylesheet', () => {
    const base = inventorySource('.root {}', 'old.module.css', 'base', 'before');
    const candidate = inventorySource('.root {}', 'new.module.scss', 'candidate', 'after');
    const imports = inventorySource(
      "import s from './nested.module.css'; export type { S } from './type.module.css';",
      'component.tsx',
      'candidate',
      'source',
    );
    expect(findCssModuleResidue([...base, ...candidate, ...imports])).toEqual([
      { file: 'new.module.scss', label: 'new.module.scss', start: 0 },
      { file: 'component.tsx', label: 'css-module:./nested.module.css', start: 0 },
    ]);
  });
});
