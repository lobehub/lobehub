import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { categorizeCase } from '../verdict/categorize';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const base = (rule = 'all: unset;') => `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({ close: css\`${rule}\` }));

export const Close = () => <button className={styles.close} />;
`;

const head = (close: string) => `import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({ close: ${close} });

export const Close = () => <button {...stylex.props(styles.close)} />;
`;

const plan = (close: string, before = base()) =>
  planFile(
    'a.tsx',
    extractFile(before, 'a.tsx', options),
    extractFile(head(close), 'a.tsx', options),
    {
      layoutComponents: [],
    },
  ).cases[0];

describe('a StyleX key the compiler drops', () => {
  it('blocks a case whose head style uses all, at any depth', () => {
    const entry = plan("{ all: 'unset' }");
    expect(entry.flags).toEqual(['STYLEX_UNSUPPORTED:all']);
    expect(categorizeCase(entry, { gaps: [], status: 'equal' })).toBe('blocking');
    const nested = plan(
      "{ cursor: { default: 'pointer', ':hover': { all: 'unset' } } }",
      base('cursor: pointer;'),
    );
    expect(nested?.flags).toContain('STYLEX_UNSUPPORTED:all');
  });

  it('leaves all alone in an emotion template', () => {
    expect(plan("{ cursor: 'pointer' }", base('cursor: pointer;')).flags).toEqual([]);
    const emotion = extractFile(base(), 'a.tsx', options);
    expect(emotion.unsupported).toBeUndefined();
  });
});
