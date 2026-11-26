import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { globalCssAdapter } from '../extract/adapters/globalCss';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const CLASS = 'lobe-view-1a2b3c4d-tabs';

const TABS_CSS = `/* moved */
.${CLASS} [role='tablist'] {
  width: 100%;
}

.${CLASS} [role='tablist'] > [role='tab']:has([data-replace-all]) {
  margin-inline-start: auto;
}
`;

const tabsBase = (
  nested = `[role='tablist'] {
      width: 100%;

      > [role='tab']:has([data-replace-all]) {
        margin-inline-start: auto;
      }
    }`,
) => `import { createStaticStyles, Tabs } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  tabs: css\`
    ${nested}
  \`,
}));

export const View = () => <Tabs className={styles.tabs} variant="square" />;
`;

const tabsHead = (className = `'${CLASS}'`) => `import './View.css';

import { Tabs } from '@lobehub/ui';

export const View = () => (
  <>
    <Tabs className={${className}} variant="square" />
  </>
);
`;

const embedBase = `import { createStaticStyles, Flexbox } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  content: css\`
    padding: 24px;

    h1 {
      white-space: normal;
    }
  \`,
}));

export const Embed = () => <Flexbox className={styles.content} gap={24} />;
`;

const embedHead = `import './Embed.css';

import { cx, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({ content: { padding: '24px' } });

export const Embed = () => (
  <Flexbox gap={24} className={cx(stylex.props(styles.content).className, 'lobe-embed-content')} />
);
`;

const options = (css: Record<string, string>) => ({
  adapters: [emotionStaticAdapter, stylexAdapter, globalCssAdapter],
  layoutComponents: ['Flexbox'],
  readStylesheet: (_from: string, specifier: string) => css[specifier],
});

const plan = (before: string, after: string, css: Record<string, string>) =>
  planFile(
    'a.tsx',
    extractFile(before, 'a.tsx', options({})),
    extractFile(after, 'a.tsx', options(css)),
    { layoutComponents: ['Flexbox'] },
  ).cases;

describe('css moved word for word into a plain stylesheet', () => {
  it('records the declarations of each rule and the stylesheet it came from', () => {
    const { rules } = extractFile(tabsHead(), 'a.tsx', options({ './View.css': TABS_CSS }));
    expect(rules[0]).toMatchObject({
      declarations: ['width: 100%'],
      selector: `.${CLASS} [role='tablist']`,
      stylesheet: './View.css',
    });
    const [base] = extractFile(tabsBase(), 'a.tsx', options({})).rules;
    expect(base.declarations).toEqual(['width: 100%']);
  });

  it('proves the class lands where the emotion class did and renders the targets it selects', () => {
    const [entry] = plan(tabsBase(), tabsHead(), { './View.css': TABS_CSS });
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toEqual(['PLACEMENT_PRESERVED', 'STYLESHEET_MOVED']);
    expect(entry.inner).toEqual({
      0: [
        {
          attributes: { role: 'tablist' },
          children: [
            {
              attributes: { role: 'tab' },
              children: [{ attributes: { 'data-replace-all': '' }, children: [], tag: 'div' }],
              tag: 'div',
            },
          ],
          tag: 'div',
        },
      ],
    });
  });

  it('clears an inner tag target once the moved rule renders on both sides', () => {
    const [entry] = plan(embedBase, embedHead, {
      './Embed.css': '.lobe-embed-content h1 {\n  white-space: normal;\n}\n',
    });
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toEqual(['STYLESHEET_MOVED']);
    expect(entry.inner).toEqual({ 0: [{ attributes: {}, children: [], tag: 'h1' }] });
  });

  it('keeps the flags when a declaration changed on the way', () => {
    const [entry] = plan(tabsBase(), tabsHead(), {
      './View.css': TABS_CSS.replace('width: 100%', 'width: 50%'),
    });
    expect(entry.flags).toEqual(['PLACEMENT_SUBSTITUTED']);
    expect(entry.inner).toBeUndefined();
  });

  it('keeps the flags when the stylesheet holds a rule nothing moved', () => {
    const [entry] = plan(tabsBase(), tabsHead(), {
      './View.css': `${TABS_CSS}\n[role='tab'] { color: red; }\n`,
    });
    expect(entry.flags).toEqual(['PLACEMENT_SUBSTITUTED']);
  });

  it('keeps the flags when the rules are in a different order', () => {
    const [first, second] = TABS_CSS.split('\n\n');
    const [entry] = plan(tabsBase(), tabsHead(), { './View.css': `${second}\n\n${first}\n` });
    expect(entry.flags).toEqual(['PLACEMENT_SUBSTITUTED']);
  });

  it('keeps the flags when the moved rules sit in a cascade layer', () => {
    const [entry] = plan(tabsBase(), tabsHead(), {
      './View.css': `@layer app {\n${TABS_CSS}\n}\n`,
    });
    expect(entry.flags).toEqual(['PLACEMENT_SUBSTITUTED']);
  });

  it('keeps the flags when a selector needs a state the page cannot build', () => {
    const nested = `[role='tablist']:first-child {
      width: 100%;
    }`;
    const [entry] = plan(tabsBase(nested), tabsHead(), {
      './View.css': `.${CLASS} [role='tablist']:first-child {\n  width: 100%;\n}\n`,
    });
    expect(entry.flags).toEqual(['PLACEMENT_SUBSTITUTED']);
  });

  it('keeps the flags when the class also lands on another element', () => {
    const head = tabsHead().replace('  </>', `    <div className={'${CLASS}'} />\n  </>`);
    const [entry] = plan(tabsBase(), head, { './View.css': TABS_CSS });
    expect(entry.flags).toEqual(['PLACEMENT_SUBSTITUTED']);
  });
});
