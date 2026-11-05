import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile, type Side } from '../plan/planFile';
import { moduleReader } from './synthesize';
import { markUnchangedChains } from './unchanged';

const COMPONENT = `import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { styles } from './styles';

export const Quote = ({ clickable, xstyle }) => (
  <Flexbox {...stylex.props(styles.quote, clickable && styles.clickable, xstyle)}>
    <span className={stylex.props(styles.label).className} />
  </Flexbox>
);
`;

const STYLES = (
  quote = 'padding: SPACE',
  space = "'4px'",
  extra = '',
) => `import * as stylex from '@stylexjs/stylex';
${extra}
const SPACE = ${space};

export const styles = stylex.create({
  clickable: { cursor: 'pointer' },
  label: { fontSize: '12px' },
  quote: { ${quote} },
});
`;

const FALLBACK = `import { createStaticStyles } from '@lobehub/ui';

export const fallback = createStaticStyles(({ css }) => ({
  editor: css\`p { margin: 0; }\`,
}));
`;

let root: string;
const roots = () => ({ base: path.join(root, 'base'), head: path.join(root, 'head') });

const write = async (side: Side, file: string, text: string) => {
  const target = path.join(roots()[side], file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
};

const plan = async (head: { component?: string; styles?: string }, base = COMPONENT) => {
  await write('base', 'src/Quote.tsx', base);
  await write('base', 'src/styles.ts', STYLES());
  await write('head', 'src/Quote.tsx', head.component ?? COMPONENT);
  await write('head', 'src/styles.ts', head.styles ?? STYLES(undefined, undefined, FALLBACK));
  const extract = (side: Side, code: string) =>
    extractFile(code, 'src/Quote.tsx', {
      adapters: [emotionStaticAdapter, stylexAdapter],
      layoutComponents: ['Flexbox'],
      readModule: moduleReader(roots()[side], {}),
    });
  const pair = {
    base: extract('base', base),
    head: extract('head', head.component ?? COMPONENT),
  };
  const result = planFile('src/Quote.tsx', pair.base, pair.head, { layoutComponents: ['Flexbox'] });
  markUnchangedChains(result, pair, {
    aliases: {},
    roots: roots(),
    sources: { base: 'src/Quote.tsx', head: 'src/Quote.tsx' },
  });
  return result.cases;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'style-eq-unchanged-'));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('an element whose own style chain did not change', () => {
  it('needs no sign-off for an unmodeled variable when only an unrelated export was added', async () => {
    const cases = await plan({});
    expect(cases.map((entry) => [entry.flags, entry.evidence])).toEqual([
      [[], ['STYLE_CHAIN_UNCHANGED', 'FILE_RULES_UNCHANGED']],
      [[], ['STYLE_CHAIN_UNCHANGED', 'FILE_RULES_UNCHANGED']],
    ]);
  });

  it('keeps the flag when a declaration the element reads changed', async () => {
    const [entry] = await plan({ styles: STYLES("padding: '8px'") });
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('keeps the flag when a constant the declaration reads changed', async () => {
    const [entry] = await plan({ styles: STYLES(undefined, "'6px'") });
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  it('keeps the flag when the element binding changed', async () => {
    const [entry] = await plan({
      component: COMPONENT.replace(', xstyle)}', ', xstyle, styles.label)}'),
    });
    expect(entry.flags).toEqual(['VARIABLE_UNMODELED']);
  });

  const inner = (other: string) => `import { createStaticStyles } from '@lobehub/ui';

const local = createStaticStyles(({ css }) => ({
  other: css\`${other}\`,
  x: css\`&.ant-btn { margin: 0; }\`,
}));

export const Quote = () => <div className={local.x} />;
`;

  it('clears any flag when the file rules are unchanged too', async () => {
    const cases = await plan({ component: inner('p { margin: 0; }') }, inner('p { margin: 0; }'));
    expect(cases[0].flags).toEqual([]);
    expect(cases[0].evidence).toContain('FILE_RULES_UNCHANGED');
  });

  it('keeps a flag beyond unmodeled variables when other rules of the file changed', async () => {
    const cases = await plan({ component: inner('p { margin: 1px; }') }, inner('p { margin: 0; }'));
    expect(cases[0].flags).toEqual(['CROSS_COMPONENT']);
  });
});
