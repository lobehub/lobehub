import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';

import type { FileExtraction } from '../extract';
import type { FilePlan } from '../plan/planFile';
import type { CaseModules } from './hostRuntime';
import { generateModule } from './module';

const tmp = path.join(import.meta.dirname, '.generated-counterpart-test');
afterAll(() => rm(tmp, { force: true, recursive: true }));

const extraction: FileExtraction = {
  elements: [
    {
      bindings: [{ expr: 'open ? styles.open : styles.row', prop: 'className', spread: false }],
      flags: [],
      id: 'Row#0',
      literalProps: {},
      owner: 'Row',
      slots: ['styles.open', 'styles.row'],
      tag: 'div',
      variables: [{ kind: 'boolean', name: 'open' }],
    },
  ],
  file: 'a.tsx',
  gaps: [],
  outsideReferences: [],
  prelude: `const styles = { open: 'open', row: 'row' };
const Text = ({ as: Tag = 'div', children, ...rest }) => <Tag data-text="" {...rest}>{children}</Tag>;`,
  rules: [],
  styleSymbols: ['styles'],
};

const plan: FilePlan = {
  cases: [],
  file: 'a.tsx',
  gaps: [],
  unpaired: [
    {
      counterpart: {
        ancestors: ['Row#0'],
        inlineStyle: "flat ? { borderRadius: 0 } : { maxWidth: '100%' }",
        literalProps: { 'data-kind': 'shot', 'title': 'x' },
        props: "{ \"variant\": (flat ? 'borderless' : 'outlined') }",
        tag: 'Image',
        variables: [{ kind: 'boolean', name: 'flat' }],
      },
      elementId: 'Row#3',
      side: 'head',
    },
    {
      counterpart: {
        ancestors: ['Row#0'],
        literalProps: {},
        props: '{ "alt": (item.label), "src": (url(item)), "width": (size ?? 24) }',
        tag: 'img',
        variables: [
          { kind: 'unknown', name: 'item' },
          { kind: 'unknown', name: 'size' },
          { kind: 'call', name: 'url' },
          { kind: 'unknown', name: 'styles' },
        ],
      },
      elementId: 'Row#4',
      side: 'head',
    },
    {
      counterpart: {
        ancestors: [],
        literalProps: { as: 'span' },
        props: '{ "title": (label) }',
        real: true,
        tag: 'Text',
        variables: [{ kind: 'unknown', name: 'label' }],
      },
      elementId: 'Row#5',
      side: 'head',
    },
  ],
};

const load = async () => {
  await mkdir(tmp, { recursive: true });
  const file = path.join(tmp, `module-${Date.now()}.tsx`);
  await writeFile(
    file,
    generateModule(extraction, plan, 'base', {
      layoutComponents: [],
      realComponents: { Text: { source: '@lobehub/ui' } },
    }),
  );
  return (await import(file)) as Required<Pick<CaseModules[string], 'unpaired'>>;
};

const render = (node: unknown) => renderToStaticMarkup(node as never);

describe('generateModule for the other side of an unpaired element', () => {
  it('renders the unstyled counterpart inside the paired ancestors with every condition off', async () => {
    const { unpaired } = await load();
    expect(render(unpaired['a.tsx|unpaired:head:Row#3']())).toBe(
      '<div data-synthetic-element="Row#0" class="row"><div data-synthetic-element="Row#3" data-kind="shot" style="max-width:100%">Ag 文本 Text</div></div>',
    );
  });

  it('passes the dynamic props of an intrinsic counterpart without redeclaring module names', async () => {
    const { unpaired } = await load();
    expect(render(unpaired['a.tsx|unpaired:head:Row#4']())).toBe(
      '<div data-synthetic-element="Row#0" class="row"><img data-synthetic-element="Row#4" width="24"/></div>',
    );
  });

  it('renders a real component counterpart with its props', async () => {
    const { unpaired } = await load();
    expect(render(unpaired['a.tsx|unpaired:head:Row#5']())).toBe(
      '<span data-text="" data-synthetic-element="Row#5">Ag 文本 Text</span>',
    );
  });
});
