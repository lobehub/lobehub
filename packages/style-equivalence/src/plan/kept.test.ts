import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: ['Flexbox'] };

const H1 = `h1 {
      overflow-wrap: anywhere;
      white-space: normal;
    }`;

const base = (nested = H1, className = 'styles.content') => `
import { createStaticStyles, cssVar, Flexbox } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  content: css\`
    padding: 24px;
    background: \${cssVar.colorBgContainer};

    ${nested}
  \`,
}));

export const Embed = ({ open }) => (
  <Flexbox className={${className}} gap={24}>
    <Goal />
  </Flexbox>
);
`;

const head = (
  kept = H1,
  host = '{...sx(styles.content, fallback.content)}',
  child = '<Goal />',
) => `
import { createStaticStyles, cssVar, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  content: { padding: '24px', backgroundColor: cssVar.colorBgContainer },
});

const fallback = createStaticStyles(({ css }) => ({
  content: css\`
    ${kept}
  \`,
}));

export const Embed = ({ open }) => (
  <Flexbox gap={24} ${host}>
    ${child}
  </Flexbox>
);
`;

const plan = (before: string, after: string) =>
  planFile('a.tsx', extractFile(before, 'a.tsx', options), extractFile(after, 'a.tsx', options), {
    layoutComponents: ['Flexbox'],
  }).cases;

const H1_NODE = { attributes: {}, children: [], tag: 'h1' };

const proven = (entry: ReturnType<typeof plan>[number]) => {
  expect(entry.flags).toEqual([]);
  expect(entry.evidence).toEqual(['EMOTION_RULE_KEPT']);
  expect(entry.inner).toEqual({ 0: [H1_NODE] });
};

const unproven = (entry: ReturnType<typeof plan>[number]) => {
  expect(entry.flags).toContain('INNER_TARGET');
  expect(entry.evidence ?? []).not.toContain('EMOTION_RULE_KEPT');
};

describe('an emotion rule kept verbatim for descendants StyleX cannot reach', () => {
  it('proves the rule when the fallback lands on the same element through sx', () => {
    const [entry] = plan(base(), head());
    proven(entry);
  });

  it('proves the rule when the fallback is joined into className with cx', () => {
    const [entry] = plan(
      base(),
      head(undefined, 'className={cx(stylex.props(styles.content).className, fallback.content)}'),
    );
    proven(entry);
  });

  it('proves the rule on a component part reached through classNames', () => {
    const before = base(undefined, 'styles.content')
      .replace('<Flexbox className={styles.content}', '<Card classNames={{ body: styles.content }}')
      .replace('</Flexbox>', '</Card>');
    const after = head(
      undefined,
      'classNames={{ body: cx(stylex.props(styles.content).className, fallback.content) }}',
    )
      .replace('<Flexbox gap={24}', '<Card gap={24}')
      .replace('</Flexbox>', '</Card>');
    const [entry] = plan(before, after);
    expect(entry.flags).not.toContain('INNER_TARGET');
    expect(entry.evidence).toContain('EMOTION_RULE_KEPT');
  });

  it('resolves interpolated tokens by expression, not by placeholder position', () => {
    const rule = `h1 {
      color: \${cssVar.colorText};
    }`;
    const [entry] = plan(base(rule), head(rule));
    proven(entry);
  });

  it('proves a rule kept under the same media condition', () => {
    const rule = `@media (width <= 767px) {
      h1 {
        white-space: normal;
      }
    }`;
    const [entry] = plan(base(rule), head(rule));
    proven(entry);
  });

  it('keeps the flag when a declaration changed', () => {
    const [entry] = plan(base(), head(H1.replace('white-space: normal', 'white-space: nowrap')));
    unproven(entry);
  });

  it('keeps the flag when an interpolated token changed', () => {
    const rule = (token: string) => `h1 {
      color: \${cssVar.${token}};
    }`;
    const [entry] = plan(base(rule('colorText')), head(rule('colorTextSecondary')));
    unproven(entry);
  });

  it('keeps the flag when one of the rules was dropped', () => {
    const [entry] = plan(base(`${H1}\n    h2 { margin: 0; }`), head());
    unproven(entry);
  });

  it('keeps the flag when the fallback is missing altogether', () => {
    const [entry] = plan(base(), head(undefined, '{...stylex.props(styles.content)}'));
    unproven(entry);
  });

  it('keeps the flag when the selector changed', () => {
    const [entry] = plan(base(), head(H1.replace('h1 {', '> h1 {')));
    unproven(entry);
  });

  it('keeps the flag when the media condition changed', () => {
    const wrap = (query: string) => `@media (${query}) {
      ${H1}
    }`;
    const [entry] = plan(base(wrap('width <= 767px')), head(wrap('width <= 768px')));
    unproven(entry);
  });

  it('keeps the flag when an interpolated condition wrapper was dropped', () => {
    const [entry] = plan(base(`\${responsive.sm} {\n      ${H1}\n    }`), head());
    unproven(entry);
  });

  it('keeps the flag when head adds another nested rule', () => {
    const [entry] = plan(base(), head(`${H1}\n    h2 { margin: 0; }`));
    unproven(entry);
  });

  it('keeps the flag when the fallback moved to a different element', () => {
    const cases = plan(
      base(),
      head(undefined, '{...stylex.props(styles.content)}', '<div className={fallback.content} />'),
    );
    unproven(cases[0]);
  });

  it('keeps the flag when only head applies the fallback conditionally', () => {
    const [entry] = plan(
      base(),
      head(undefined, '{...sx(styles.content, open && fallback.content)}'),
    );
    unproven(entry);
  });

  it('keeps the flag when only base applied the rule conditionally', () => {
    const [entry] = plan(
      base(undefined, 'open ? styles.content : undefined'),
      head(undefined, '{...sx(open && styles.content, fallback.content)}'),
    );
    unproven(entry);
  });

  it('keeps the flag when the fallback is defined but not applied', () => {
    const [entry] = plan(
      base(),
      head(undefined, '{...stylex.props(styles.content)} data-fallback={fallback.content}'),
    );
    unproven(entry);
  });

  it('keeps the flag when the fallback goes to a different component part', () => {
    const before = base()
      .replace('<Flexbox className={styles.content}', '<Card classNames={{ body: styles.content }}')
      .replace('</Flexbox>', '</Card>');
    const after = head(undefined, 'classNames={{ header: fallback.content }}')
      .replace('<Flexbox gap={24}', '<Card gap={24}')
      .replace('</Flexbox>', '</Card>');
    const [entry] = plan(before, after);
    unproven(entry);
  });
});
