import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const plan = (before: string, after: string) => {
  const pair = {
    base: extractFile(before, 'a.tsx', options),
    head: extractFile(after, 'a.tsx', options),
  };
  const result = planFile('a.tsx', pair.base, pair.head, { layoutComponents: [] });
  const module = (side: 'base' | 'head') =>
    generateModule(pair[side], result, side, { layoutComponents: [] });
  return { module, result };
};

describe('an inline style the synthetic page can evaluate', () => {
  it('renders a style chosen by a boolean on the side that passes it to the style prop', () => {
    const { module, result } = plan(
      `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({ overlay: css\`opacity: 0;\` }));

export const Row = ({ uploading }) => (
  <div className={styles.overlay} style={uploading ? { opacity: 1 } : undefined} />
);
`,
      `import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const styles = stylex.create({ overlay: { opacity: 0 } });

export const Row = ({ uploading }) => <div {...sx(styles.overlay, uploading && { opacity: 1 })} />;
`,
    );
    const [entry] = result.cases;
    expect(entry.flags).toEqual([]);
    expect(entry.variables).toEqual([
      { kinds: { base: 'boolean', head: 'boolean' }, name: 'uploading' },
    ]);
    expect(module('base')).toContain('style={(uploading ? { opacity: 1 } : undefined)}');
  });

  it('keeps a style that reads an imported constant and renders it on a stand-in', () => {
    const { module, result } = plan(
      `import { controlHeight, createStaticStyles, Select } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  trigger: css\`min-height: \${controlHeight.middle}px;\`,
}));

export const Filter = () => (
  <Select className={styles.trigger} style={{ maxWidth: 260, minWidth: 160 }} />
);
`,
      `import { controlHeight, Select } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({ trigger: { borderRadius: 6 } });

export const Filter = () => (
  <Select
    className={stylex.props(styles.trigger).className}
    style={{ maxWidth: 260, minHeight: controlHeight.middle, minWidth: 160 }}
  />
);
`,
    );
    const [entry] = result.cases;
    expect(entry.flags).not.toContain('RUNTIME_STYLE_DROPPED');
    const head = module('head');
    expect(head).toMatch(/import \{[^}]*controlHeight[^}]*\} from '@lobehub\/ui'/);
    expect(head).toContain(
      'style={({ maxWidth: 260, minHeight: controlHeight.middle, minWidth: 160 })}',
    );
    expect(module('base')).toContain('style={{"maxWidth":260,"minWidth":160}}');
  });

  it('leaves a style that reads a local value it cannot model unrendered', () => {
    const { module } = plan(
      `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({ bar: css\`opacity: 0;\` }));

export const Bar = ({ width }) => <div className={styles.bar} style={{ width }} />;
`,
      `import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({ bar: { opacity: 0 } });

export const Bar = ({ width }) => <div {...stylex.props(styles.bar)} style={{ width }} />;
`,
    );
    expect(module('base')).not.toContain('style={(');
  });
});
