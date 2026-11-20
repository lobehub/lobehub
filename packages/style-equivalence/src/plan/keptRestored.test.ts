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

describe('a restored rule that reads module constants', () => {
  const CONTENT = 'lobe-comments-2aa3-content';
  const contentCss = (height = '480px') => `.${CONTENT}
  img:not(
    img:is([style^='width:'], [style*=' width:'])
  ) {
  width: auto !important;
  max-height: ${height};
}

.${CONTENT} [contenteditable='true'] ~ div {
  margin-block-start: 0 !important;
}
`;
  const contentBase = `import './Comment.css';

export const Content = () => <div className={'${CONTENT}'} />;
`;
  const contentHead = (height = '480') => `import { createStaticStyles } from '@lobehub/ui';

const MAX_HEIGHT = ${height};
const RESIZED_IMAGE = 'img:is([style^="width:"], [style*=" width:"])';

const fallback = createStaticStyles(({ css }) => ({
  content: css\`
    & img:not(\${RESIZED_IMAGE}) {
      width: auto !important;
      max-height: \${MAX_HEIGHT}px;
    }

    & [contenteditable='true'] ~ div {
      margin-block-start: 0 !important;
    }
  \`,
}));

export const Content = () => <div className={fallback.content} />;
`;
  const run = (head: string, css = contentCss()) =>
    planFile(
      'a.tsx',
      extractFile(contentBase, 'a.tsx', options({ './Comment.css': css })),
      extractFile(head, 'a.tsx', options({})),
      { layoutComponents: [] },
    ).cases[0];

  it('folds the constants, ignores quote style and proves selectors it cannot render', () => {
    const entry = run(contentHead());
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toContain('EMOTION_RULE_KEPT');
    expect(entry.inner).toBeUndefined();
  });

  it('keeps the flag when a folded constant differs from the stylesheet value', () => {
    const entry = run(contentHead('400'));
    expect(entry.flags).toEqual(['INNER_TARGET']);
  });
});

describe('a stylesheet class joined with StyleX classes in an expression', () => {
  const MD = 'lobe-body-b06f-md';
  const mdCss = `.${MD} > div {\n  padding-block-end: 40px;\n}\n`;
  const mdBase = (className: string) => `import './Body.css';

import { Markdown } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({ md: { overflow: 'hidden' } });

export const Body = () => <Markdown className={${className}}>{text}</Markdown>;
`;
  const mdHead = (
    host = '{...sx(styles.md, fallback.md)}',
  ) => `import { createStaticStyles, Markdown } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const styles = stylex.create({ md: { overflow: 'hidden' } });

const fallback = createStaticStyles(({ css }) => ({
  md: css\`
    & > div {
      padding-block-end: 40px;
    }
  \`,
}));

export const Body = () => <Markdown ${host}>{text}</Markdown>;
`;
  const run = (before: string, after = mdHead()) =>
    planFile(
      'a.tsx',
      extractFile(before, 'a.tsx', options({ './Body.css': mdCss })),
      extractFile(after, 'a.tsx', options({})),
      { layoutComponents: [] },
    ).cases[0];

  it('maps the class inside cx to its stylesheet and keeps the placement through sx', () => {
    const entry = run(mdBase(`cx(stylex.props(styles.md).className, '${MD}')`));
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toEqual(['PLACEMENT_PRESERVED', 'EMOTION_RULE_KEPT']);
  });

  it('maps the class inside a template literal', () => {
    const entry = run(mdBase(`\`\${stylex.props(styles.md).className} \${'${MD}'}\``));
    expect(entry.flags).not.toContain('INNER_TARGET');
    expect(entry.evidence).toContain('EMOTION_RULE_KEPT');
  });

  it('maps the class written in the template text itself', () => {
    const entry = run(mdBase(`\`\${stylex.props(styles.md).className} ${MD}\``));
    expect(entry.flags).not.toContain('INNER_TARGET');
    expect(entry.evidence).toContain('EMOTION_RULE_KEPT');
  });

  it('keeps the placement flag when head passes the fallback through another prop', () => {
    const entry = run(
      mdBase(`cx(stylex.props(styles.md).className, '${MD}')`),
      mdHead('{...sx(styles.md)} classNames={{ root: fallback.md }}'),
    );
    expect(entry.flags).toContain('INNER_TARGET');
  });
});

describe('a theme token read through a renamed import', () => {
  it('resolves cssVar imported under another name', () => {
    const css = `.docx-f4c0-scroll .docx-wrapper > section.docx {\n  box-shadow: var(--lobe-box-shadow-tertiary);\n}\n`;
    const before = `import './Docx.css';\n\nexport const Docx = () => <div className={'docx-f4c0-scroll'} />;\n`;
    const after = (
      token: string,
    ) => `import { createStaticStyles, cssVar as cssVarValue } from '@lobehub/ui';

const fallback = createStaticStyles(({ css }) => ({
  scroll: css\`
    .docx-wrapper > section.docx {
      box-shadow: \${cssVarValue.${token}};
    }
  \`,
}));

export const Docx = () => <div className={fallback.scroll} />;
`;
    const run = (token: string) =>
      planFile(
        'a.tsx',
        extractFile(before, 'a.tsx', options({ './Docx.css': css })),
        extractFile(after(token), 'a.tsx', options({})),
        { layoutComponents: [] },
      ).cases[0];
    expect(run('boxShadowTertiary').flags).toEqual([]);
    expect(run('boxShadowSecondary').flags).toContain('INNER_TARGET');
  });
});

describe('a stylesheet class held in a local constant', () => {
  it('maps the constant to its stylesheet and proves the rule restored in a fallback', () => {
    const css = `.kanban-14c7-card * {\n  cursor: default;\n}\n\n.kanban-14c7-card:active * {\n  cursor: grabbing;\n}\n`;
    const before = `import './Card.css';

import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const CARD_SCOPE_CLASS = 'kanban-14c7-card';

const styles = stylex.create({ card: { cursor: 'default' } });

export const Card = () => <div {...sx([styles.card], CARD_SCOPE_CLASS)} />;
`;
    const after = (rule = 'cursor: grabbing;') => `import { createStaticStyles } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const styles = stylex.create({ card: { cursor: 'default' } });

const fallback = createStaticStyles(({ css }) => ({
  card: css\`
    & * {
      cursor: default;
    }

    &:active * {
      ${rule}
    }
  \`,
}));

export const Card = () => <div {...sx([styles.card], fallback.card)} />;
`;
    const run = (head: string) =>
      planFile(
        'a.tsx',
        extractFile(before, 'a.tsx', options({ './Card.css': css })),
        extractFile(head, 'a.tsx', options({})),
        { layoutComponents: [] },
      ).cases[0];
    const base = extractFile(before, 'a.tsx', options({ './Card.css': css }));
    expect(base.elements[0].slots).toContain('global.kanban-14c7-card');
    const restored = run(after());
    expect(restored.evidence).toContain('EMOTION_RULE_KEPT');
    expect(restored.flags).toEqual([]);
    expect(run(after('cursor: move;')).evidence ?? []).not.toContain('EMOTION_RULE_KEPT');
  });
});
