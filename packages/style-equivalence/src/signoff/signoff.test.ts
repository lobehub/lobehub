import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extractFile } from '../extract';
import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { moduleReader } from '../pipeline/synthesize';
import { planFile } from '../plan/planFile';
import { collectCaseHashInput, contentHash } from './hash';
import { readSignoffs, signoffPath, writeSignoffs } from './store';

let root: string;
const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const source = `import * as stylex from '@stylexjs/stylex';
import { styles } from './A.styles';
export const A = () => <div {...stylex.props(styles.box)} />;
`;
const stylesFile = (padding: number) => `import * as stylex from '@stylexjs/stylex';
export const styles = stylex.create({ box: { padding: ${padding} }, other: { margin: 1 } });
`;

const hashOf = async (
  outcome?: Array<{ after?: string; before?: string; key: string; property: string }>,
) => {
  const code = await readFile(path.join(root, 'src/A.tsx'), 'utf8');
  const extraction = extractFile(code, 'src/A.tsx', {
    ...options,
    readModule: moduleReader(root, {}),
  });
  const plan = planFile('src/A.tsx', extraction, extraction, { layoutComponents: [] });
  return contentHash(
    collectCaseHashInput({
      aliases: {},
      extractions: { base: extraction, head: extraction },
      plan: plan.cases[0],
      roots: { base: root, head: root },
      sources: { base: 'src/A.tsx', head: 'src/A.tsx' },
      outcome,
      verifierVersion: '1.2.3',
    }),
  );
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'style-eq-signoff-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/A.tsx'), source);
  await writeFile(path.join(root, 'src/A.styles.ts'), stylesFile(4));
});

afterAll(() => rm(root, { force: true, recursive: true }));

describe('contentHash', () => {
  it('changes when the declaration a case uses changes, even in an imported module', async () => {
    const before = await hashOf();
    expect(await hashOf()).toBe(before);
    await writeFile(
      path.join(root, 'src/A.styles.ts'),
      stylesFile(4).replace('margin: 1', 'margin: 2'),
    );
    expect(await hashOf()).toBe(before);
    await writeFile(path.join(root, 'src/A.styles.ts'), stylesFile(6));
    expect(await hashOf()).not.toBe(before);
  });
});

describe('contentHash outcome', () => {
  it('changes when what differs changes, so a false-positive sign-off does not carry over', async () => {
    const cause = {
      after: 'normal',
      before: '"tnum"',
      key: 'root.0',
      property: 'font-feature-settings',
    };
    const signed = await hashOf([cause]);
    expect(await hashOf([cause])).toBe(signed);
    expect(await hashOf([{ ...cause, property: 'color' }])).not.toBe(signed);
  });
});

describe('signoff store', () => {
  it('keeps one file per source and merges records by key', async () => {
    const record = {
      hash: 'h1',
      key: 'src/A.tsx|A#0',
      note: 'div stands in for Image',
      reason: 'PLACEMENT_SUBSTITUTED',
      signedAt: '2026-11-04T00:00:00.000Z',
      signer: 'innei',
    };
    await writeSignoffs(root, 'src/A.tsx', [record]);
    await writeSignoffs(root, 'src/A.tsx', [{ ...record, hash: 'h2' }]);
    expect(signoffPath(root, 'src/A.tsx')).toBe(
      path.join(root, '.style-equivalence/signoffs/src/A.tsx.json'),
    );
    expect([...(await readSignoffs(root, ['src/A.tsx', 'src/Missing.tsx'])).values()]).toEqual([
      { ...record, hash: 'h2' },
    ]);
  });
});
