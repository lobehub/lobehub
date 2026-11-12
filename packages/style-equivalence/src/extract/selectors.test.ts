import { describe, expect, it } from 'vitest';

import { cssModulesAdapter } from './adapters/cssModules';
import { emotionStaticAdapter } from './adapters/emotionStatic';
import { globalCssAdapter } from './adapters/globalCss';
import { stylexAdapter } from './adapters/stylex';
import { extractFile } from './index';

const stylesheets: Record<string, string> = {
  'feature/QueueTray.css':
    '.queue-tray-thumb { border-radius: 4px; }\n.queue-tray-thumb img { width: 100%; }',
  'feature/Panel.module.css':
    '.panel { padding: 8px; }\n.panel .title { color: red; }\n.panel :global(.ant-btn) { color: blue; }',
};

const options = {
  adapters: [emotionStaticAdapter, stylexAdapter, cssModulesAdapter, globalCssAdapter],
  layoutComponents: ['Flexbox'],
  readStylesheet: (from: string, specifier: string) =>
    stylesheets[`${from.split('/').slice(0, -1).join('/')}/${specifier.replace('./', '')}`],
};

const flagsById = (code: string, file = 'feature/A.tsx') =>
  Object.fromEntries(extractFile(code, file, options).elements.map((e) => [e.id, e.flags]));

describe('selector classification', () => {
  it('flags an element whose slot styles a class owned by another component', () => {
    const code = `import { createStaticStyles, cx, Flexbox } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({
  muted: css\`
    .control-label { color: gray; }
  \`,
  row: css\`
    height: 40px;
    &:hover { background: red; }
  \`,
}));
export const Row = ({ muted }) => <Flexbox className={cx(styles.row, muted && styles.muted)} />;
export const Plain = () => <div className={styles.row} />;
`;
    expect(flagsById(code)).toEqual({ 'Plain#0': [], 'Row#0': ['CROSS_COMPONENT'] });
  });

  it("flags an element whose class is the target of another element's cross-component rule", () => {
    const code = `import { createStaticStyles, cx } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({
  label: css\`color: black;\`,
  muted: css\`.control-label { color: gray; }\`,
}));
const Label = () => <span className={cx(styles.label, 'control-label')} />;
export const Row = ({ muted }) => <div className={cx(muted && styles.muted)}><Label /></div>;
`;
    expect(flagsById(code)).toEqual({
      'Label#0': ['CROSS_COMPONENT'],
      'Row#0': ['CROSS_COMPONENT'],
    });
  });

  it('flags a descendant selector that reaches into a child type', () => {
    const code = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({
  thumb: css\`
    & img { width: 100%; }
  \`,
}));
export const Thumb = () => <Image className={styles.thumb} />;
`;
    expect(flagsById(code)).toEqual({ 'Thumb#0': ['INNER_TARGET'] });
  });

  it('treats a literal className matched by an imported global stylesheet as a styled element', () => {
    const code = `import './QueueTray.css';
export const Tray = () => (
  <div className="queue-tray">
    <Image className="queue-tray-thumb" />
  </div>
);
`;
    const result = extractFile(code, 'feature/A.tsx', options);
    expect(result.elements.map((e) => [e.id, e.tag, e.slots, e.flags])).toEqual([
      ['Tray#0', 'Image', ['global.queue-tray-thumb'], ['INNER_TARGET']],
    ]);
    expect(result.prelude).toContain("import './QueueTray.css';");
  });

  it('reads a global className written as a braced string literal', () => {
    const code = `import './QueueTray.css';
export const Tray = () => <Image className={'queue-tray-thumb'} />;
`;
    expect(extractFile(code, 'feature/A.tsx', options).elements.map((e) => e.slots)).toEqual([
      ['global.queue-tray-thumb'],
    ]);
  });

  it('reads CSS module classes as owned slots and flags :global targets', () => {
    const code = `import styles from './Panel.module.css';
export const Panel = () => (
  <div className={styles.panel}>
    <span className={styles.title}>t</span>
  </div>
);
`;
    const result = extractFile(code, 'feature/A.tsx', options);
    expect(result.styleSymbols).toEqual(['styles']);
    expect(Object.fromEntries(result.elements.map((e) => [e.id, e.flags]))).toEqual({
      'Panel#0': ['CROSS_COMPONENT'],
      'Panel#1': [],
    });
  });
});
