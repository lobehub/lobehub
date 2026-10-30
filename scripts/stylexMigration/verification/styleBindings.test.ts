// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeStyleBindings, bindingObserverExport, prepareStyleBindings } from './styleBindings';

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { force: true, recursive: true });
});

describe('source binding observer', () => {
  it('resolves imported factory aliases and preserves slot source ranges, including unmounted slots', () => {
    const code =
      'import {createStaticStyles as make} from "@lobehub/ui"; const styles=make(({css})=>{return {root:css`color:red`, unused:css`display:none`}});';
    const result = analyzeStyleBindings(code, 'Component.tsx');
    expect(result.bindings[0].slots.map((slot) => slot.name)).toEqual(['root', 'unused']);
    expect(code.slice(result.bindings[0].slots[1].start, result.bindings[0].slots[1].end)).toBe(
      'unused:css`display:none`',
    );
    expect(result.gaps).toContain('LEGACY_TEMPLATE_RULE_SOURCE_UNPROVEN');
    expect(analyzeStyleBindings('const styles=make({root:1})', 'Other.tsx').bindings).toHaveLength(
      0,
    );
  });
  it('retains dynamic slots and unsupported factory returns as gaps', () => {
    expect(
      analyzeStyleBindings(
        'import {createStaticStyles as make} from "@lobehub/ui"; const styles=make(()=>({[dynamic]:1,...more}));',
        'Dynamic.tsx',
      ).gaps.length,
    ).toBeGreaterThan(0);
  });
  it('supports parenthesized object returns but refuses conditional return inference', () => {
    const simple = analyzeStyleBindings(
      'import {createStaticStyles as make} from "@lobehub/ui"; const styles=make(({css})=>({root:css`color:red`}));',
      'Simple.tsx',
    );
    expect(simple.bindings[0].slots[0].name).toBe('root');
    const conditional = analyzeStyleBindings(
      'import {createStaticStyles as make} from "@lobehub/ui"; const styles=make(({css})=>{if(flag)return {hidden:css`color:red`};return {root:css`color:blue`};});',
      'Conditional.tsx',
    );
    expect(conditional.gaps).toContain('STATIC_FACTORY_CONTROL_FLOW_UNSUPPORTED');
    expect(conditional.bindings).toHaveLength(0);
  });

  it('inventories inactive CSS module rules without executing or changing the source component', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'stylex-bindings-test-'));
    owned.push(root);
    await mkdir(path.join(root, 'src'));
    const code = 'import styles from "./Table.module.css"; export const Component=()=>styles.root;';
    await writeFile(path.join(root, 'src/Component.tsx'), code);
    await writeFile(
      path.join(root, 'src/Table.module.css'),
      '.root {color:red} @container (max-width:600px){.root:hover td::before {content:"x"}} .unused{display:none}',
    );
    const plan = await prepareStyleBindings(root, 'src/Component.tsx');
    expect(plan.bindings[0].slots.map((slot) => slot.name)).toEqual(['root', 'unused']);
    expect(plan.stylesheets[0].rules[1].conditions).toEqual([
      { kind: 'container', text: '(max-width:600px)' },
    ]);
    expect(plan.stylesheets[0].rules).toHaveLength(3);
    expect(bindingObserverExport(plan)).toContain('"styles":styles');
    expect(await readFile(path.join(root, 'src/Component.tsx'), 'utf8')).toBe(code);
  });
});
