import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';

import type { FileExtraction, StyleElement } from '../extract';
import type { FilePlan } from '../plan/planFile';
import { generateHost } from './host';
import { CaseList, type CaseModules, INNER_BASELINE, readSelection } from './hostRuntime';
import { generateModule } from './module';

const tmp = path.join(import.meta.dirname, '.generated-test');
afterAll(() => rm(tmp, { force: true, recursive: true }));

const prelude = `const cx = (...names) => names.filter(Boolean).join(' ');
const Flexbox = ({ className, children }) => <div data-flex="" className={className}>{children}</div>;
const styles = { a: 'a', b: 'b', c: 'c', item: 'item', itemDragging: 'itemDragging' };
const PILL = { on: 'a' };
const TONE = { on: 'b', off: 'c' };`;

const element = (
  id: string,
  tag: string,
  expr: string,
  extra: Partial<StyleElement> = {},
): StyleElement => ({
  bindings: [{ expr, prop: 'className', spread: false }],
  flags: [],
  id,
  literalProps: {},
  owner: id.split('#')[0],
  slots: [...new Set(expr.match(/\bstyles\.\w+/g) ?? [])].sort(),
  tag,
  variables: [],
  ...extra,
});

const extraction: FileExtraction = {
  elements: [
    element('A#0', 'Flexbox', 'isDragging ? cx(styles.item, styles.itemDragging) : styles.item', {
      variables: [{ kind: 'boolean', name: 'isDragging' }],
    }),
    element(
      'A#1',
      'span',
      'cx(styles.a, isActive() && styles.b, item.done && styles.c, size && styles.a)',
      {
        parent: 'A#0',
        variables: [
          { kind: 'call', name: 'isActive' },
          { kind: 'member', name: 'item' },
          { kind: 'unknown', name: 'size' },
        ],
      },
    ),
    element('C#0', 'span', 'cx(PILL[attrs.kind] ?? styles.b, attrs.meta.color && styles.c)', {
      variables: [{ kind: 'unknown', name: 'attrs' }],
    }),
    element(
      'K#0',
      'span',
      "cx(styles.a, state.kind === 'x' ? styles.b : state.kind !== 'y' && styles.c)",
      {
        variables: [{ kind: 'unknown', name: 'state' }],
      },
    ),
    element('T#0', 'span', 'cx(styles.a, TONE[tone])', {
      variables: [{ kind: 'unknown', name: 'tone' }],
    }),
    element('D#0', 'details', 'styles.a', { children: ['D#0/0'] }),
    element('I#0', 'div', 'styles.a'),
    element('I#1', 'span', 'styles.b', { parent: 'I#0' }),
    element('P#0', 'div', 'styles.a', { runtimeStyle: 'laneStyle' }),
    element('P#1', 'span', 'styles.b', { parent: 'P#0' }),
    element('K#1', 'span', 'cx(styles.a,', {
      variables: [{ kind: 'unknown', name: 'state' }],
    }),
    element('B#0', 'SortableList.Item', 'styles.a', {
      bindings: [
        { expr: 'styles.a', prop: 'className', spread: false },
        { expr: 'styles.b', prop: 'itemClassName', spread: false },
      ],
      literalProps: { 'data-id': 'x', 'onClick': 'y', 'title': 'hidden' },
    }),
  ],
  file: 'a.tsx',
  gaps: [],
  outsideReferences: [],
  plain: [
    {
      ...element('D#0/0', 'summary', ''),
      bindings: [],
      literalProps: { title: 'raw' },
      parent: 'D#0',
    },
  ],
  prelude,
  rules: [],
  styleSymbols: ['styles'],
};

const plan: FilePlan = {
  cases: [
    {
      combos: [],
      elementIds: { base: 'A#0', head: 'A#0' },
      file: 'a.tsx',
      flags: [],
      key: 'a.tsx|A#0',
      variables: [{ kinds: { base: 'boolean', head: 'boolean' }, name: 'isDragging' }],
    },
    {
      combos: [],
      elementIds: { base: 'A#1', head: 'A#1' },
      file: 'a.tsx',
      flags: ['VARIABLE_UNMODELED'],
      key: 'a.tsx|A#1',
      variables: [
        { kinds: { base: 'call', head: 'call' }, name: 'isActive' },
        { kinds: { base: 'boolean', head: 'boolean' }, name: 'isDragging' },
        { kinds: { base: 'member', head: 'member' }, name: 'item' },
      ],
    },
    {
      combos: [],
      elementIds: { base: 'C#0', head: 'C#0' },
      file: 'a.tsx',
      flags: ['VARIABLE_UNMODELED'],
      key: 'a.tsx|C#0',
      variables: [],
    },
    {
      combos: [],
      elementIds: { base: 'K#0', head: 'K#0' },
      file: 'a.tsx',
      flags: [],
      key: 'a.tsx|K#0',
      knobs: ["state.kind === 'x'", "state.kind !== 'y'"],
      variables: [],
    },
    {
      combos: [],
      elementIds: { base: 'T#0', head: 'T#0' },
      file: 'a.tsx',
      flags: [],
      key: 'a.tsx|T#0',
      variables: [
        {
          kinds: { base: 'unknown', head: 'unknown' },
          name: 'tone',
          values: ['off', 'on', '__style_equivalence_absent__'],
        },
      ],
    },
    {
      combos: [],
      elementIds: { base: 'I#1', head: 'I#1' },
      file: 'a.tsx',
      flags: [],
      inner: {
        0: [{ attributes: { role: 'tablist' }, children: [], tag: 'div' }],
        1: [
          { attributes: {}, children: [], tag: 'h1' },
          { attributes: { className: 'x' }, children: [], tag: 'img' },
        ],
      },
      key: 'a.tsx|I#1',
      variables: [],
    },
    {
      combos: [],
      elementIds: { base: 'D#0/0', head: 'D#0/0' },
      file: 'a.tsx',
      flags: [],
      key: 'a.tsx|D#0/0',
      variables: [],
    },
    {
      combos: [],
      elementIds: { base: 'P#1', head: 'P#1' },
      file: 'a.tsx',
      flags: [],
      key: 'a.tsx|P#1',
      variables: [{ kinds: { head: 'unknown' }, name: 'laneStyle', probe: true }],
    },
    {
      combos: [],
      elementIds: { base: 'K#1', head: 'K#1' },
      file: 'a.tsx',
      flags: [],
      key: 'a.tsx|K#1',
      knobs: ["state.kind === 'x'"],
      variables: [],
    },
    {
      combos: [],
      elementIds: { base: 'B#0', head: 'B#0' },
      file: 'a.tsx',
      flags: [],
      key: 'a.tsx|B#0',
      variables: [],
    },
  ],
  file: 'a.tsx',
  gaps: [],
  unpaired: [{ elementId: 'A#1', side: 'base' }],
};

const load = async () => {
  await mkdir(tmp, { recursive: true });
  const file = path.join(tmp, `module-${Date.now()}.tsx`);
  await writeFile(
    file,
    generateModule(extraction, plan, 'base', { layoutComponents: ['Flexbox'] }),
  );
  return (await import(file)) as Required<Pick<CaseModules[string], 'cases' | 'unpaired'>>;
};

const render = (node: unknown) => renderToStaticMarkup(node as never);

describe('generateModule', () => {
  it('applies the combo to the composition expression', async () => {
    const { cases } = await load();
    expect(render(cases['a.tsx|A#0']({ isDragging: true }))).toBe(
      '<div data-flex="" class="item itemDragging">Ag 文本 Text</div>',
    );
    expect(render(cases['a.tsx|A#0']({ isDragging: false }))).toBe(
      '<div data-flex="" class="item">Ag 文本 Text</div>',
    );
  });

  it('models call and member conditions, binds unknown names to undefined and nests the chain', async () => {
    const { cases } = await load();
    expect(render(cases['a.tsx|A#1']({ isActive: true, isDragging: false, item: true }))).toBe(
      '<div data-flex="" class="item"><span data-synthetic-element="A#1" class="a b c">Ag 文本 Text</span></div>',
    );
    expect(
      render(cases['a.tsx|A#1']({ isActive: false, isDragging: false, item: false })),
    ).toContain('class="a"');
  });

  it('renders an unmodeled value that is read through members and indexes instead of throwing', async () => {
    const { cases } = await load();
    expect(render(cases['a.tsx|C#0']({}))).toContain('class="b c"');
  });

  it('binds each condition knob so every branch renders', async () => {
    const { cases } = await load();
    const knob = (x: boolean, y: boolean) =>
      render(cases['a.tsx|K#0']({ "state.kind !== 'y'": y, "state.kind === 'x'": x }));
    expect(knob(true, false)).toContain('class="a b"');
    expect(knob(false, true)).toContain('class="a c"');
    expect(knob(false, false)).toContain('class="a"');
  });

  it('renders a table lookup with each key of its domain', async () => {
    const { cases } = await load();
    expect(render(cases['a.tsx|T#0']({ tone: 'on' }))).toContain('class="a b"');
    expect(render(cases['a.tsx|T#0']({ tone: 'off' }))).toContain('class="a c"');
    expect(render(cases['a.tsx|T#0']({ tone: '__style_equivalence_absent__' }))).toContain(
      'class="a"',
    );
  });

  it('passes a probe style to the runtime style of the chain only when the combo turns it on', async () => {
    const { cases } = await load();
    const on = render(cases['a.tsx|P#1']({ laneStyle: true }));
    expect(on).toContain(
      '<div data-synthetic-element="P#0" class="a" style="--style-equivalence-probe:laneStyle;tab-size:7">',
    );
    expect(render(cases['a.tsx|P#1']({ laneStyle: false }))).not.toContain('style=');
  });

  it('renders a plain child inside its styled parent', async () => {
    const { cases } = await load();
    expect(render(cases['a.tsx|D#0/0']({}))).toBe(
      '<details data-synthetic-element="D#0" class="a"><summary data-synthetic-element="D#0/0" title="raw">Ag 文本 Text</summary></details>',
    );
  });

  it('renders the inner targets a moved stylesheet selects inside each chain element', async () => {
    const { cases } = await load();
    expect(render(cases['a.tsx|I#1']({}))).toBe(
      '<div data-synthetic-element="I#0" class="a"><span data-synthetic-element="I#1" class="b">Ag 文本 Text<h1 data-synthetic-inner="">Ag 文本 Text</h1><img data-synthetic-inner="" class="x"/></span><div data-synthetic-inner="" role="tablist">Ag 文本 Text</div></div>',
    );
  });

  it('fails a knob case it cannot bind instead of rendering it unbound', async () => {
    const { cases } = await load();
    expect(() => cases['a.tsx|K#1']({})).toThrow('KNOB_UNBOUND');
  });

  it('renders an element that exists on one side only with every condition off', async () => {
    const { unpaired } = await load();
    expect(Object.keys(unpaired)).toEqual(['a.tsx|unpaired:base:A#1']);
    expect(render(unpaired['a.tsx|unpaired:base:A#1']())).toBe(
      '<div data-flex="" class="item"><span data-synthetic-element="A#1" class="a">Ag 文本 Text</span></div>',
    );
  });

  it('substitutes non-layout components with a div and renders neutral props as children', async () => {
    const { cases } = await load();
    expect(render(cases['a.tsx|B#0']({}))).toBe(
      '<div data-synthetic-element="B#0" data-id="x" class="a">Ag 文本 Text<div data-synthetic-neutral="itemClassName" class="b">Ag 文本 Text</div></div>',
    );
  });
});

describe('CaseList', () => {
  it('renders every combo of every case, or only the selected one', async () => {
    const mod = await load();
    const fullPlan = [
      {
        ...plan,
        cases: plan.cases
          .filter(
            (entry) =>
              !['a.tsx|D#0/0', 'a.tsx|I#1', 'a.tsx|K#1', 'a.tsx|P#1', 'a.tsx|T#0'].includes(
                entry.key,
              ),
          )
          .map((entry) => ({
            ...entry,
            combos:
              entry.key === 'a.tsx|A#0' ? [{ isDragging: false }, { isDragging: true }] : [{}],
          })),
      },
    ];
    const all = render(createElement(CaseList, { modules: { 'a.tsx': mod }, plan: fullPlan }));
    expect(all.match(/data-case=/g)).toHaveLength(6);
    expect(all).toContain(`<style>${INNER_BASELINE}</style>`);
    expect(all).toContain('data-case="a.tsx|A#0|1"');
    const one = render(
      createElement(CaseList, {
        modules: { 'a.tsx': mod },
        plan: fullPlan,
        selection: { caseKey: 'a.tsx|A#0', combo: 1 },
      }),
    );
    expect(one.match(/data-case=/g)).toHaveLength(1);
    expect(one).toContain('class="item itemDragging"');
  });

  it('renders a one-sided element only when it is selected', async () => {
    const mod = await load();
    const all = render(createElement(CaseList, { modules: { 'a.tsx': mod }, plan: [plan] }));
    expect(all).not.toContain('unpaired');
    const one = render(
      createElement(CaseList, {
        modules: { 'a.tsx': mod },
        plan: [plan],
        selection: { caseKey: 'a.tsx|unpaired:base:A#1', combo: 0 },
      }),
    );
    expect(one.match(/data-case="[^"]*"/g)).toEqual(['data-case="a.tsx|unpaired:base:A#1|0"']);
    expect(one).toContain('<span data-synthetic-element="A#1" class="a">');
  });

  it('renders only the cases named in the cases query parameter', async () => {
    const mod = await load();
    const fullPlan = [
      {
        ...plan,
        cases: plan.cases
          .filter(
            (entry) =>
              !['a.tsx|D#0/0', 'a.tsx|I#1', 'a.tsx|K#1', 'a.tsx|P#1', 'a.tsx|T#0'].includes(
                entry.key,
              ),
          )
          .map((entry) => ({
            ...entry,
            combos:
              entry.key === 'a.tsx|A#0' ? [{ isDragging: false }, { isDragging: true }] : [{}],
          })),
      },
    ];
    const selection = readSelection(`?cases=${encodeURIComponent(JSON.stringify(['a.tsx|A#0']))}`);
    const html = render(
      createElement(CaseList, { modules: { 'a.tsx': mod }, plan: fullPlan, selection }),
    );
    expect(html.match(/data-case="[^"]*"/g)).toEqual([
      'data-case="a.tsx|A#0|0"',
      'data-case="a.tsx|A#0|1"',
    ]);
  });

  it('reads the selected cases from the URL fragment, which never reaches the server', () => {
    expect(
      readSelection('?theme=dark', `#cases=${encodeURIComponent(JSON.stringify(['a.tsx|A#0']))}`),
    ).toEqual({ caseKeys: ['a.tsx|A#0'] });
  });

  it('renders the cases of a module that failed to load as errors', () => {
    const html = render(
      createElement(CaseList, {
        modules: { 'a.tsx': { cases: {}, error: 'MODULE_LOAD_FAILED: boom' } },
        plan: [{ ...plan, cases: plan.cases.map((entry) => ({ ...entry, combos: [{}] })) }],
      }),
    );
    expect(html).toContain('data-synthetic-error="MODULE_LOAD_FAILED: boom"');
  });
});

describe('generateHost', () => {
  it('loads each module on its own so one load-time throw does not stop the host', () => {
    const code = generateHost({
      hostWrapper: '/host.tsx',
      modules: [
        { file: 'a.tsx', specifier: './a.tsx' },
        { file: 'b.tsx', specifier: './b.tsx' },
      ],
      runtime: '/runtime.tsx',
      themeAttribute: 'data-theme',
    });
    expect(code).not.toMatch(/import \* as/);
    expect(code).toContain('import("./a.tsx")');
    expect(code).toContain('MODULE_LOAD_FAILED');
  });
});
