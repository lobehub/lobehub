import { describe, expect, it } from 'vitest';

import type { FileExtraction } from '../extract';
import type { FilePlan } from '../plan/planFile';
import { flagUncheckedCallers } from './forwardCallers';

const extraction = (file: string, props: string[]): FileExtraction => ({
  elements: props.map((prop, index) => ({
    bindings: [{ expr: 'styles.title', prop, spread: false }],
    flags: [],
    id: `A#${index}`,
    literalProps: {},
    owner: 'A',
    slots: [],
    tag: 'Identity',
    variables: [],
  })),
  file,
  gaps: [],
  outsideReferences: [],
  prelude: '',
  rules: [],
  styleSymbols: [],
});

const plans = (): FilePlan[] => [
  {
    cases: [
      {
        combos: [{}],
        elementIds: { base: 'I#0/0', head: 'I#1' },
        file: 'Identity.tsx',
        flags: [],
        forwardedParam: 'titleXstyle',
        key: 'Identity.tsx|I#0/0',
        variables: [],
      },
    ],
    file: 'Identity.tsx',
    gaps: [],
    unpaired: [],
  },
];

const sources: Record<string, string> = {
  'Embed.tsx': '<Identity titleXstyle={styles.title} />',
  'Other.tsx': 'const props = { titleXstyle: styles.title };',
};

const run = async (files: string[], scoped: Record<string, string[]>) => {
  const list = plans();
  await flagUncheckedCallers(list, {
    extractions: Object.fromEntries(
      Object.entries(scoped).map(([file, props]) => [
        file,
        { base: extraction(file, []), head: extraction(file, props) },
      ]),
    ),
    grep: async () => ['Identity.tsx', ...files],
    read: (file) => sources[file] ?? '',
  });
  return list[0].cases[0].flags;
};

describe('callers of a forwarded prop', () => {
  it('accepts callers whose every mention is a style binding the tool compares', async () => {
    expect(await run(['Embed.tsx'], { 'Embed.tsx': ['titleXstyle'] })).toEqual([]);
  });

  it('flags a caller outside the compared files', async () => {
    expect(await run(['Embed.tsx', 'Other.tsx'], { 'Embed.tsx': ['titleXstyle'] })).toEqual([
      'FORWARDED_CALLER_UNCHECKED:Other.tsx',
    ]);
  });

  it('flags a compared caller that mentions the prop outside a style binding', async () => {
    expect(await run(['Other.tsx'], { 'Other.tsx': [] })).toEqual([
      'FORWARDED_CALLER_UNCHECKED:Other.tsx',
    ]);
  });
});
