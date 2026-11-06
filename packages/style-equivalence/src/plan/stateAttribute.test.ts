import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const base = (value = 'true') => `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  day: css\`
    color: red;

    &[data-rate-limited='${value}'] [data-day-secondary] {
      color: inherit;
    }
  \`,
  tokens: css\`color: gray;\`,
}));

export const Day = ({ rateLimited }) => (
  <div className={styles.day} data-rate-limited={rateLimited}>
    <span data-day-secondary className={styles.tokens} />
  </div>
);
`;

const head = `import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  day: { color: 'red' },
  inheritColor: { color: 'inherit' },
  tokens: { color: 'gray' },
});

export const Day = ({ rateLimited }) => (
  <div {...stylex.props(styles.day)} data-rate-limited={rateLimited}>
    <span data-day-secondary {...stylex.props(styles.tokens, rateLimited && styles.inheritColor)} />
  </div>
);
`;

const plan = (before: string) => {
  const pair = {
    base: extractFile(before, 'a.tsx', options),
    head: extractFile(head, 'a.tsx', options),
  };
  return { pair, plan: planFile('a.tsx', pair.base, pair.head, { layoutComponents: [] }) };
};

describe('a state attribute driven by the variable a StyleX condition reads', () => {
  it('models the attribute with the variable on the side that styles through it', () => {
    const { pair, plan: result } = plan(base());
    const tokens = result.cases.find((entry) => entry.key === 'a.tsx|Day#1');
    expect(tokens?.flags).not.toContain('ASYMMETRIC_CONDITION');
    expect(tokens?.variables).toEqual([
      { kinds: { base: 'boolean', head: 'boolean' }, name: 'rateLimited' },
    ]);
    expect(generateModule(pair.base, result, 'base', { layoutComponents: [] })).toContain(
      'data-rate-limited={rateLimited}',
    );
  });

  it('leaves an attribute whose selectors compare it with other values unmodeled', () => {
    const tokens = plan(base('open')).plan.cases.find((entry) => entry.key === 'a.tsx|Day#1');
    expect(tokens?.flags).toContain('ASYMMETRIC_CONDITION');
  });
});
