import type { CorpusExpectation } from '../cssCorpus';

export interface SourceCorpusEntry {
  base: Record<string, string>;
  expected: CorpusExpectation;
  feature: string;
  head: Record<string, string>;
  id: string;
}

const emotion = (
  styles: string,
  jsx: string,
  extra = '',
) => `import { createStaticStyles, cx } from '@lobehub/ui';
${extra}
const styles = createStaticStyles(({ css }) => ({
${styles}
}));

export const Sample = ({ active, disabled }: { active?: boolean; disabled?: boolean }) => (
${jsx}
);
`;

const stylexSource = (
  styles: string,
  jsx: string,
  extra = '',
) => `import * as stylex from '@stylexjs/stylex';
${extra}
const styles = stylex.create({
${styles}
});

export const Sample = ({ active, disabled }: { active?: boolean; disabled?: boolean }) => (
${jsx}
);
`;

export const SOURCE_CORPUS: SourceCorpusEntry[] = [
  {
    base: {
      'font-inherit.tsx': emotion(
        "  root: css`font-feature-settings: 'tnum';`,\n  button: css`font: inherit; font-size: 12px;`,",
        '  <div className={styles.root}>\n    <button className={styles.button} type="button">A</button>\n  </div>',
      ),
    },
    expected: 'changed',
    feature: 'font: inherit 拆成 longhand',
    head: {
      'font-inherit.tsx': stylexSource(
        "  root: { fontFeatureSettings: \"'tnum'\" },\n  button: { fontFamily: 'inherit', fontSize: 12, fontWeight: 'inherit', lineHeight: 'inherit' },",
        '  <div {...stylex.props(styles.root)}>\n    <button {...stylex.props(styles.button)} type="button">A</button>\n  </div>',
      ),
    },
    id: 'font-inherit',
  },
  {
    base: {
      'background-split.tsx': emotion(
        '  box: css`background: rgb(255, 0, 0);`,',
        '  <div className={styles.box} />',
      ),
    },
    expected: 'equivalent',
    feature: 'background 拆成 color + image none',
    head: {
      'background-split.tsx': stylexSource(
        "  box: { backgroundColor: 'rgb(255, 0, 0)', backgroundImage: 'none' },",
        '  <div {...stylex.props(styles.box)} />',
      ),
    },
    id: 'background-split',
  },
  {
    base: {
      'condition-combos.tsx': emotion(
        '  a: css`padding: 4px;`,\n  b: css`color: rgb(0, 0, 255);`,\n  c: css`opacity: 0.5;`,',
        '  <div className={cx(styles.a, active && styles.b, disabled && styles.c)} />',
      ),
    },
    expected: 'equivalent',
    feature: '条件组合',
    head: {
      'condition-combos.tsx': stylexSource(
        "  a: { padding: 4 },\n  b: { color: 'rgb(0, 0, 255)' },\n  c: { opacity: 0.5 },",
        '  <div {...stylex.props(styles.a, active && styles.b, disabled && styles.c)} />',
      ),
    },
    id: 'condition-combos',
  },
  {
    base: {
      'merge-order.tsx': emotion(
        '  a: css`color: rgb(255, 0, 0);`,\n  b: css`color: rgb(0, 128, 0);`,',
        '  <div className={cx(styles.a, styles.b)} />',
      ),
    },
    expected: 'changed',
    feature: 'cx 与 stylex.props 合并顺序',
    head: {
      'merge-order.tsx': stylexSource(
        "  a: { color: 'rgb(255, 0, 0)' },\n  b: { color: 'rgb(0, 128, 0)' },",
        '  <div {...stylex.props(styles.b, styles.a)} />',
      ),
    },
    id: 'merge-order',
  },
  {
    base: {
      'when-ancestor.tsx': emotion(
        '  row: css`\n    padding: 4px;\n\n    &:hover .row-action {\n      opacity: 1;\n    }\n  `,\n  action: css`opacity: 0;`,',
        "  <div className={styles.row}>\n    <span className={cx(styles.action, 'row-action')}>A</span>\n  </div>",
      ),
    },
    expected: 'equivalent',
    feature: '同组件后代选择器改写成 when.ancestor',
    head: {
      'when-ancestor.tsx': stylexSource(
        "  row: { padding: 4 },\n  action: { opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 } },",
        '  <div {...stylex.props(styles.row, stylex.defaultMarker())}>\n    <span {...stylex.props(styles.action)}>A</span>\n  </div>',
      ),
    },
    id: 'when-ancestor',
  },
  {
    base: {
      'keyframes.module.css':
        '.spin {\n  animation: original-spin 1s linear infinite;\n}\n\n@keyframes original-spin {\n  from { opacity: 1; }\n  to { opacity: 0.2; }\n}\n',
      'keyframes.tsx':
        "import styles from './keyframes.module.css';\n\nexport const Sample = () => <div className={styles.spin} />;\n",
    },
    expected: 'equivalent',
    feature: 'keyframes',
    head: {
      'keyframes.tsx': stylexSource(
        "  spin: { animationName: spin, animationDuration: '1s', animationTimingFunction: 'linear', animationIterationCount: 'infinite' },",
        '  <div {...stylex.props(styles.spin)} />',
        'const spin = stylex.keyframes({ from: { opacity: 1 }, to: { opacity: 0.2 } });',
      ),
    },
    id: 'keyframes',
  },
  {
    base: {
      'nested-hover.tsx': emotion(
        '  link: css`\n    color: rgb(0, 0, 0);\n\n    &:hover {\n      color: rgb(255, 0, 0);\n    }\n  `,',
        '  <a className={styles.link}>A</a>',
      ),
    },
    expected: 'equivalent',
    feature: '嵌套 :hover',
    head: {
      'nested-hover.tsx': stylexSource(
        "  link: { color: { default: 'rgb(0, 0, 0)', ':hover': 'rgb(255, 0, 0)' } },",
        '  <a {...stylex.props(styles.link)}>A</a>',
      ),
    },
    id: 'nested-hover',
  },
  {
    base: {
      'pseudo-element.tsx': emotion(
        "  mark: css`\n    &::before {\n      content: '*';\n      color: rgb(255, 0, 0);\n    }\n  `,",
        '  <span className={styles.mark}>A</span>',
      ),
    },
    expected: 'equivalent',
    feature: '伪元素',
    head: {
      'pseudo-element.tsx': stylexSource(
        "  mark: { '::before': { content: \"'*'\", color: 'rgb(255, 0, 0)' } },",
        '  <span {...stylex.props(styles.mark)}>A</span>',
      ),
    },
    id: 'pseudo-element',
  },
  {
    base: {
      'constant-interpolation.tsx': emotion(
        '  box: css`padding: ${GAP}px;`,',
        '  <div className={styles.box} />',
        'const GAP = 8;',
      ),
    },
    expected: 'equivalent',
    feature: '常量插值',
    head: {
      'constant-interpolation.tsx': stylexSource(
        '  box: { padding: GAP },',
        '  <div {...stylex.props(styles.box)} />',
        'const GAP = 8;',
      ),
    },
    id: 'constant-interpolation',
  },
  {
    base: {
      'jsx-prop-value.tsx': emotion(
        '  icon: css`width: 12px; height: 12px;`,',
        '  <Slot icon={<span className={styles.icon} />} />',
        'const Slot = ({ icon }: { icon: unknown }) => <div>{icon as never}</div>;',
      ),
    },
    expected: 'equivalent',
    feature: 'JSX 作为 prop 值',
    head: {
      'jsx-prop-value.tsx': stylexSource(
        '  icon: { width: 12, height: 12 },',
        '  <Slot icon={<span {...stylex.props(styles.icon)} />} />',
        'const Slot = ({ icon }: { icon: unknown }) => <div>{icon as never}</div>;',
      ),
    },
    id: 'jsx-prop-value',
  },
  {
    base: {
      'cross-component.tsx': emotion(
        '  muted: css`\n    .control-label {\n      color: rgb(128, 128, 128);\n    }\n  `,',
        '  <div className={cx(active && styles.muted)} />',
      ),
    },
    expected: 'flagged',
    feature: '跨组件选择器',
    head: {
      'cross-component.tsx': stylexSource(
        "  muted: { color: 'rgb(128, 128, 128)' },",
        '  <div {...stylex.props(active && styles.muted)} />',
      ),
    },
    id: 'cross-component',
  },
];
