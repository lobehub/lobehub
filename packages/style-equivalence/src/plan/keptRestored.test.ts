import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { globalCssAdapter } from '../extract/adapters/globalCss';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const TOKEN = 'lobe-tasks-group-config-4e0dc256-form';

const CSS = `.${TOKEN} label,
.${TOKEN} label * {
  font-size: 13px !important;
  color: var(--lobe-color-text-secondary) !important;
}
`;

const base = (extra = '') => `import './Config.css';

import { Form } from '@lobehub/ui/form';

export const Config = () => (
  <>
    <Form className={'${TOKEN}'} />
    ${extra}
  </>
);
`;

const head = (
  rule = `label,
      label * {
        font-size: 13px !important;
        color: \${cssVar.colorTextSecondary} !important;
      }`,
) => `import { createStaticStyles } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';

const fallback = createStaticStyles(({ css, cssVar }) => ({
  form: css\`
    ${rule}
  \`,
}));

export const Config = () => (
  <>
    <Form className={fallback.form} />
  </>
);
`;

const options = (css: Record<string, string>) => ({
  adapters: [emotionStaticAdapter, stylexAdapter, globalCssAdapter],
  layoutComponents: ['Flexbox'],
  readStylesheet: (_from: string, specifier: string) => css[specifier],
});

const plan = (before: string, after: string, css = CSS) =>
  planFile(
    'a.tsx',
    extractFile(before, 'a.tsx', options({ './Config.css': css })),
    extractFile(after, 'a.tsx', options({})),
    { layoutComponents: ['Flexbox'] },
  ).cases;

describe('a plain stylesheet rule restored verbatim into an emotion fallback', () => {
  it('proves the rule, resolves the theme token and keeps the component placement', () => {
    const [entry] = plan(base(), head());
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toEqual(['PLACEMENT_PRESERVED', 'EMOTION_RULE_KEPT']);
    expect(entry.inner).toEqual({
      0: [
        { attributes: {}, children: [{ attributes: {}, children: [], tag: 'div' }], tag: 'label' },
      ],
    });
  });

  it('keeps the flags when the token resolves to a different variable', () => {
    const [entry] = plan(base(), head().replace('colorTextSecondary', 'colorTextTertiary'));
    expect(entry.flags).toEqual(['INNER_TARGET', 'PLACEMENT_SUBSTITUTED']);
  });

  it('keeps the flags when the stylesheet class also lands on another element', () => {
    const [entry] = plan(base(`<div className={'${TOKEN}'} />`), head());
    expect(entry.flags).toContain('INNER_TARGET');
    expect(entry.evidence ?? []).not.toContain('EMOTION_RULE_KEPT');
  });

  it('keeps the flags when one selector of the list was dropped', () => {
    const rule = `label {
        font-size: 13px !important;
        color: \${cssVar.colorTextSecondary} !important;
      }`;
    const [entry] = plan(base(), head(rule));
    expect(entry.flags).toContain('INNER_TARGET');
  });
});

describe('a cross-component descendant rule kept verbatim', () => {
  const chartBase = (host = '') =>
    `import './Chart.css';

import { SparkAreaChart } from '@lobehub/charts';

export const Chart = () => <SparkAreaChart className={'spark-94e4'} />;
`.replace("'spark-94e4'", `'spark-94e4${host}'`);
  const chartCss = (extra = '') => `.spark-94e4 path.recharts-area-area[name='target'] {
  fill: none;
}
${extra}`;
  const chartHead = `import { createStaticStyles } from '@lobehub/ui';
import { SparkAreaChart } from '@lobehub/charts';

const fallback = createStaticStyles(({ css }) => ({
  spark: css\`
    & path.recharts-area-area[name='target'] {
      fill: none;
    }
  \`,
}));

export const Chart = () => <SparkAreaChart className={fallback.spark} />;
`;
  const run = (before: string, css: string) =>
    planFile(
      'a.tsx',
      extractFile(before, 'a.tsx', options({ './Chart.css': css })),
      extractFile(chartHead, 'a.tsx', options({})),
      { layoutComponents: [] },
    ).cases[0];

  it('clears the cross-component flag when every rule on the element was kept', () => {
    const entry = run(chartBase(), chartCss());
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toContain('EMOTION_RULE_KEPT');
  });

  it('keeps the cross-component flag when a host rule on a foreign class was not kept', () => {
    const entry = run(chartBase(), chartCss('.spark-94e4.recharts-wrapper { color: red; }\n'));
    expect(entry.flags).toContain('CROSS_COMPONENT');
  });
});
