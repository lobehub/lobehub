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

const disclosure = (attribute: string, head = attribute) => {
  const before = `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  header: css\`
    padding: 4px;

    &:not([data-expanded]):hover {
      background: gray;
    }
  \`,
}));

export const Row = ({ open, status, check }) => (
  <div className={styles.header} ${attribute}>
    x
  </div>
);
`;
  const after = `import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  header: { padding: '4px' },
  headerCollapsed: { backgroundColor: { default: null, ':hover': 'gray' } },
});

export const Row = ({ open, status, check }) => (
  <div ${head} {...stylex.props(styles.header, !open && styles.headerCollapsed)}>
    x
  </div>
);
`;
  const pair = {
    base: extractFile(before, 'b.tsx', options),
    head: extractFile(after, 'b.tsx', options),
  };
  const result = planFile('b.tsx', pair.base, pair.head, { layoutComponents: [] });
  return {
    entry: result.cases.find((item) => item.key === 'b.tsx|Row#0'),
    module: (side: 'base' | 'head') =>
      generateModule(pair[side], result, side, { layoutComponents: [] }),
    pair,
  };
};

describe('a state attribute whose value is evaluable from the case variables', () => {
  it('renders a conditional presence attribute with its condition as a variable on both sides', () => {
    const { entry, module } = disclosure(`data-expanded={open ? '' : undefined}`);
    expect(entry?.flags).not.toContain('ASYMMETRIC_CONDITION');
    expect(entry?.variables).toEqual([
      { kinds: { base: 'boolean', head: 'boolean' }, name: 'open' },
    ]);
    expect(module('base')).toContain(`data-expanded={open ? '' : undefined}`);
    expect(module('base')).toContain('const open = __v["open"];');
    expect(module('head')).toContain(`data-expanded={open ? '' : undefined}`);
  });

  it('renders a value chosen by a compound condition', () => {
    const { entry, module } = disclosure(`data-expanded={open || status ? 'yes' : undefined}`);
    expect(entry?.variables.map((variable) => variable.name)).toEqual(['open', 'status']);
    expect(entry?.variables[1].kinds).toEqual({ base: 'boolean', head: 'boolean' });
    expect(module('base')).toContain(`data-expanded={open || status ? 'yes' : undefined}`);
  });

  it('renders state attributes spread from a conditional object', () => {
    const attribute = `{...(open ? { 'data-expanded': '' } : {})}`;
    const { entry, module, pair } = disclosure(attribute);
    expect(entry?.variables).toEqual([
      { kinds: { base: 'boolean', head: 'boolean' }, name: 'open' },
    ]);
    expect(pair.base.elements[0].foreignSpread).toBeUndefined();
    expect(module('base')).toContain(
      `data-expanded={(open ? { 'data-expanded': '' } : {})?.["data-expanded"]}`,
    );
  });

  it('leaves an attribute it cannot evaluate unrendered without inventing a variable', () => {
    const { entry, module } = disclosure(
      `data-expanded={status === 'done' ? '' : undefined} data-check={check.id}`,
      '',
    );
    expect(entry?.variables).toEqual([{ kinds: { head: 'boolean' }, name: 'open' }]);
    expect(module('base')).not.toContain('data-expanded=');
    expect(module('base')).not.toContain('data-check=');
  });

  it('keeps a spread carrying non-state props foreign', () => {
    const { module, pair } = disclosure(`{...(open ? { 'data-expanded': '', title: 'x' } : {})}`);
    expect(pair.base.elements[0].foreignSpread).toBe(true);
    expect(module('base')).not.toContain('data-expanded=');
  });
});
