import { describe, expect, it } from 'vitest';

import { UnsupportedCssError } from './css';
import { transformSource } from './transform';

const squash = (code: string) => code.replaceAll(/\s+/g, ' ');

describe('transformSource', () => {
  it('rewrites the factory, imports and DOM className usages', () => {
    const source = `import { createStaticStyles, cx, Flexbox } from '@lobehub/ui';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css\`
    color: \${cssVar.colorText};
  \`,
  active: css\`
    font-weight: 600;
  \`,
}));

export const A = ({ active }: { active: boolean }) => (
  <div className={cx(styles.root, active && styles.active)}>
    <span className={styles.root} />
  </div>
);
`;
    const { code, mergesOutsideClassName } = transformSource(source);
    const out = squash(code);

    expect(mergesOutsideClassName).toBe(0);
    expect(out).toContain("import { cx, Flexbox } from '@lobehub/ui';");
    expect(out).toContain("import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';");
    expect(out).toContain("import * as stylex from '@stylexjs/stylex';");
    expect(out).toContain(
      'const styles = stylex.create({ root: { color: cssVar.colorText }, active: { fontWeight: 600 } });',
    );
    expect(out).toContain('<div {...stylex.props(styles.root, active && styles.active)}>');
    expect(out).toContain('<span {...stylex.props(styles.root)} />');
    expect(out).not.toContain('createStaticStyles');
  });

  it('passes a className string to components and to DOM elements with a style prop', () => {
    const source = `import { createStaticStyles, Flexbox } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({ root: css\`gap: 4px;\` }));
export const A = () => (
  <>
    <Flexbox className={styles.root} />
    <div className={styles.root} style={{ width: 1 }} />
    <Flexbox classNames={{ root: styles.root }} />
  </>
);
`;
    const out = squash(transformSource(source).code);

    expect(out).toContain('<Flexbox className={stylex.props(styles.root).className} />');
    expect(out).toContain(
      '<div className={stylex.props(styles.root).className} style={{ width: 1 }} />',
    );
    expect(out).toContain('classNames={{ root: stylex.props(styles.root).className }}');
  });

  it('keeps one stylex.props per cx call and counts outside classNames placed before it', () => {
    const source = `import { createStaticStyles, cx } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\`, b: css\`gap: 2px;\` }));
export const A = ({ className, on }: { className?: string; on: boolean }) => (
  <section className={cx(className, styles.a, on ? styles.b : undefined)} />
);
`;
    const { code, mergesOutsideClassName } = transformSource(source);

    expect(mergesOutsideClassName).toBe(1);
    expect(squash(code)).toContain(
      'className={cx(stylex.props(styles.a, on ? styles.b : undefined).className, className)}',
    );
  });

  it('turns responsive into media consts, inside and outside the styles', () => {
    const source = `import { createStaticStyles, responsive } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({
  root: css\`
    gap: 8px;
    \${responsive.sm} {
      gap: 4px;
    }
  \`,
}));
export const query = responsive.sm;
export const A = () => <div className={styles.root} />;
`;
    const out = squash(transformSource(source).code);

    expect(out).toContain("import { media } from '@lobehub/ui/stylex/media.stylex';");
    expect(out).toContain('gap: { default: "8px", [media.sm]: "4px" }');
    expect(out).toContain('export const query = media.sm;');
    expect(out).not.toMatch(/import \{[^}]*responsive/);
  });

  it('accepts a factory whose block only returns the styles', () => {
    const source = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => {
  return { root: css\`gap: 4px;\` };
});
export const A = () => <div className={styles.root} />;
`;
    expect(squash(transformSource(source).code)).toContain(
      'stylex.create({ root: { gap: "4px" } })',
    );
  });

  it.each([
    [
      'exported styles',
      `export const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));`,
    ],
    [
      'styles passed around',
      `const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));
export const all = styles;`,
    ],
    [
      'dynamic keys',
      `const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));
export const pick = (k: 'a') => styles[k];`,
    ],
    [
      'a shadowing binding',
      `const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));
export const A = ({ styles }: { styles: { a: string } }) => <div className={styles.a} />;`,
    ],
    [
      'an outside class after the styles, which StyleX would outrank',
      `const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));
export const A = ({ className }: { className?: string }) => <div className={cx(styles.a, className)} />;`,
    ],
    [
      'style refs kept in a lookup object',
      `const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\`, b: css\`gap: 2px;\` }));
const TONE = { b: styles.b };
export const A = ({ t }: { t: 'b' }) => <div className={cx(TONE[t])} />;`,
    ],
    [
      'an existing stylex binding',
      `const stylex = 1;
const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));
export const A = () => <div className={styles.a} />;`,
    ],
  ])('rejects %s', (_label, body) => {
    const source = `import { createStaticStyles, cx } from '@lobehub/ui';\n${body}\n`;
    expect(() => transformSource(source)).toThrow(UnsupportedCssError);
  });

  it('ignores JSX attributes and keys that are also named styles', () => {
    const source = `import { createStaticStyles, Modal } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));
export const A = () => <Modal className={styles.a} styles={{ body: { padding: 0 } }} />;
`;
    expect(squash(transformSource(source).code)).toContain(
      '<Modal className={stylex.props(styles.a).className} styles={{ body: { padding: 0 } }} />',
    );
  });

  it('merges template-literal class lists into one stylex.props call', () => {
    const source = `import { Block, createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({
  a: css\`cursor: pointer;\`,
  b: css\`cursor: not-allowed;\`,
  c: css\`gap: 1px;\`,
}));
export const A = ({ off, on }: { off: boolean; on: boolean }) => (
  <>
    <Block className={\`\${styles.a} \${off ? styles.b : ''}\`} />
    <div className={\`\${styles.c} \${on ? '' : styles.b}\`} />
  </>
);
`;
    const out = squash(transformSource(source).code);

    expect(out).toContain(
      '<Block className={stylex.props(styles.a, off && styles.b).className} />',
    );
    expect(out).toContain('<div {...stylex.props(styles.c, !on && styles.b)} />');
  });

  it('refuses template literals that mix StyleX classes with other text', () => {
    const source = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));
export const A = ({ className }: { className?: string }) => (
  <div className={\`\${styles.a} \${className}\`} />
);
`;
    expect(() => transformSource(source)).toThrow(UnsupportedCssError);
  });

  it('drops cx when it only wraps StyleX arguments', () => {
    const source = `import { createStaticStyles, cx, Text } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\` }));
export const A = ({ on }: { on: boolean }) => <Text className={cx(!on && styles.a)} />;
`;
    expect(squash(transformSource(source).code)).toContain(
      '<Text className={stylex.props(!on && styles.a).className} />',
    );
  });

  it('keeps compound template conditions grouped', () => {
    const source = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({
  a: css\`gap: 1px;\`,
  b: css\`gap: 2px;\`,
  c: css\`gap: 3px;\`,
}));
export const A = ({ x, y }: { x?: boolean; y?: boolean }) => (
  <>
    <div className={\`\${styles.a} \${x || y ? styles.b : ''}\`} />
    <div className={\`\${styles.a} \${x ?? y ? '' : styles.b}\`} />
    <div className={\`\${styles.a} \${x ? (y ? styles.b : styles.c) : ''}\`} />
  </>
);
`;
    const out = squash(transformSource(source).code);

    expect(out).toContain('<div {...stylex.props(styles.a, (x || y) && styles.b)} />');
    expect(out).toContain('<div {...stylex.props(styles.a, !(x ?? y) && styles.b)} />');
    expect(out).toContain('<div {...stylex.props(styles.a, x && (y ? styles.b : styles.c))} />');
  });

  it('rejects class templates stored outside JSX', () => {
    const source = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({ a: css\`gap: 1px;\`, b: css\`gap: 2px;\` }));
export const A = () => {
  const cls = \`\${styles.a} \${styles.b}\`;
  return <div className={cls} />;
};
`;
    expect(() => transformSource(source)).toThrow(UnsupportedCssError);
  });
});
