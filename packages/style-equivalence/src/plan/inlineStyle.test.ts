import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const base = `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({ divider: css\`width: 4px;\` }));

export const Split = ({ view }) => (
  <div className={styles.divider} style={{ left: \`\${view.ratio * 100}%\` }} />
);
`;

const head = (
  style = '{ left: `${view.ratio * 100}%` }',
) => `import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const styles = stylex.create({ divider: { width: '4px' } });

export const Split = ({ view }) => <div {...sx([styles.divider], undefined, ${style})} />;
`;

const plan = (after: string) => {
  const pair = {
    base: extractFile(base, 'a.tsx', options),
    head: extractFile(after, 'a.tsx', options),
  };
  return { pair, plan: planFile('a.tsx', pair.base, pair.head, { layoutComponents: [] }) };
};

describe('an inline style moved from the style prop into sx', () => {
  it('renders neither side with it when the expression is the same', () => {
    const { pair, plan: result } = plan(head());
    const [entry] = result.cases;
    expect(entry.flags).toEqual([]);
    expect(entry.variables).toEqual([]);
    expect(entry.inlineStyles?.head).toEqual([
      { binding: 0, index: 0, without: 'sx([styles.divider], undefined, undefined)' },
    ]);
    const module = generateModule(pair.head, result, 'head', { layoutComponents: [] });
    expect(module).not.toContain('view.ratio');
  });

  it('keeps the variable when the style expression changed', () => {
    const [entry] = plan(head('{ left: `${view.ratio * 50}%` }')).plan.cases;
    expect(entry.inlineStyles).toBeUndefined();
    expect(entry.flags).toContain('VARIABLE_UNMODELED');
  });
});
