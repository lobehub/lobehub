import { describe, expect, it } from 'vitest';

import type { FileExtraction, StyleElement } from '../extract';
import type { FilePlan } from '../plan/planFile';
import { attachCounterparts } from './counterparts';

const base = `export const Row = ({ flat }) => (
  <div className={styles.row}>
    <Image preview style={flat ? { borderRadius: 0 } : { maxWidth: '100%' }} />
  </div>
);
`;

const head = `export const Row = ({ flat }) => (
  <div {...stylex.props(styles.row)}>
    <Image preview {...stylex.props(flat && styles.image)} />
  </div>
);
`;

const element = (id: string, tag: string, expr: string, parent?: string): StyleElement => ({
  bindings: [{ expr, prop: '...', spread: true }],
  flags: [],
  id,
  literalProps: {},
  owner: 'Row',
  ...(parent ? { parent } : {}),
  slots: [],
  tag,
  variables: [],
});

const extraction = (elements: StyleElement[]) => ({ elements }) as unknown as FileExtraction;

const plan = (): FilePlan => ({
  cases: [
    {
      combos: [],
      elementIds: { base: 'Row#0', head: 'Row#0' },
      file: 'a.tsx',
      flags: [],
      key: 'a.tsx|Row#0',
      variables: [],
    },
  ],
  file: 'a.tsx',
  gaps: [],
  unpaired: [{ elementId: 'Row#1', side: 'head' }],
});

describe('attachCounterparts', () => {
  it('records the other-side element under the paired ancestors of an unpaired element', () => {
    const target = plan();
    attachCounterparts(target, {
      code: { base, head },
      extractions: {
        base: extraction([element('Row#0', 'div', 'styles.row')]),
        head: extraction([
          element('Row#0', 'div', 'stylex.props(styles.row)'),
          element('Row#1', 'Image', 'stylex.props(flat && styles.image)', 'Row#0'),
        ]),
      },
    });

    expect(target.unpaired[0].counterpart).toEqual({
      ancestors: ['Row#0'],
      inlineStyle: "flat ? { borderRadius: 0 } : { maxWidth: '100%' }",
      literalProps: { preview: true },
      tag: 'Image',
      variables: [{ kind: 'boolean', name: 'flat' }],
    });
  });

  it('leaves an unpaired element alone when the other side has no such file', () => {
    const target = plan();
    attachCounterparts(target, {
      code: { head },
      extractions: {
        base: extraction([]),
        head: extraction([element('Row#1', 'Image', 'stylex.props(flat && styles.image)')]),
      },
    });

    expect(target.unpaired[0].counterpart).toBeUndefined();
  });
});
