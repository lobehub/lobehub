import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FileExtraction } from '../extract';
import { type AssembleInput, assembleVerdict } from './assemble';

const FILE = 'src/Item.tsx';

const baseCode = `export const Item = ({ flat }) => (
  <Image variant={flat ? 'borderless' : 'outlined'} style={{ maxWidth: '100%' }} />
);
`;

const headCode = `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({ image: { width: '100%' } });
export const Item = ({ flat }) => (
  <Image style={{ maxWidth: '100%' }} {...stylex.props(flat && styles.image)} />
);
`;

const extraction = (elements: FileExtraction['elements']) =>
  ({ elements, outsideReferences: [] }) as unknown as FileExtraction;

let dir: string;
let input: AssembleInput;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'style-eq-assemble-'));
  for (const [side, code] of [
    ['base', baseCode],
    ['head', headCode],
  ] as const) {
    await mkdir(path.join(dir, side, 'src'), { recursive: true });
    await writeFile(path.join(dir, side, FILE), code);
  }
  input = {
    aliases: {},
    calibration: [],
    cases: [],
    extractions: {
      [FILE]: {
        base: extraction([]),
        head: extraction([
          {
            bindings: [{ expr: 'stylex.props(flat && styles.image)', prop: '...', spread: true }],
            flags: [],
            id: 'Item#0',
            literalProps: {},
            owner: 'Item',
            slots: ['styles.image'],
            tag: 'Image',
            variables: [],
          },
        ]),
      },
    },
    mutation: { passed: true },
    plans: [{ cases: [], file: FILE, gaps: [], unpaired: [{ elementId: 'Item#0', side: 'head' }] }],
    recordsDir: path.join(dir, 'records'),
    roots: { base: path.join(dir, 'base'), head: path.join(dir, 'head') },
    scope: [{ base: FILE, head: FILE, reason: 'changed' }],
    unparsedSelectors: [],
    verifierVersion: '2.15.0',
  } as unknown as AssembleInput;
});

afterAll(() => rm(dir, { force: true, recursive: true }));

describe('assembleVerdict for an unpaired element', () => {
  it('records the unstyled same-position element of the other side', async () => {
    const { evidence } = await assembleVerdict(input);

    expect(evidence[`${FILE}|unpaired:head:Item#0`].counterpart).toEqual({
      base: "<Image variant={flat ? 'borderless' : 'outlined'} style={{ maxWidth: '100%' }} />",
    });
  });

  it('keeps the counterpart out of the sign-off hash', async () => {
    const { verdict } = await assembleVerdict(input);
    const { verdict: without } = await assembleVerdict({
      ...input,
      roots: { ...input.roots, base: path.join(dir, 'missing') },
    });

    expect(verdict.items[0].hash).toBe(without.items[0].hash);
  });
});
