import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import type { RealComponent } from '../extract/types';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const realComponents: Record<string, RealComponent> = {
  Tabs: {
    leaf: true,
    sample: (content) => `items={[{ key: 'a', label: 'a' }, { key: 'b', label: <>${content}</> }]}`,
    source: '@lobehub/ui',
  },
  Text: { source: '@lobehub/ui', tag: { default: 'div', prop: 'as' } },
};

const options = {
  adapters: [emotionStaticAdapter, stylexAdapter],
  layoutComponents: ['Flexbox'],
  realComponents,
};

const base = (
  source = '@lobehub/ui',
  element = '<Tabs className={styles.tabs} variant="square" items={items} />',
) => `
import { createStaticStyles } from '@lobehub/ui';
import { Tabs } from '${source}';

const styles = createStaticStyles(({ css }) => ({
  tabs: css\`
    [role='tablist'] {
      width: 100%;

      > [role='tab']:has([data-replace-all]) {
        margin-inline-start: auto;
      }
    }
  \`,
}));

export const View = ({ items }) => ${element};
`;

const head = (
  source = '@lobehub/ui',
  element = `<Tabs variant="square" classNames={{ list: stylex.props(styles.tabList).className, tab: stylex.props(styles.tab).className }} items={items} />`,
) => `
import * as stylex from '@stylexjs/stylex';
import { Tabs } from '${source}';

const styles = stylex.create({
  tab: { marginInlineStart: { default: null, ':has([data-replace-all])': 'auto' } },
  tabList: { width: '100%' },
});

export const View = ({ items }) => ${element};
`;

const config = { layoutComponents: ['Flexbox'], realComponents };

const both = (before: string, after: string) => {
  const extractions = {
    base: extractFile(before, 'a.tsx', options),
    head: extractFile(after, 'a.tsx', options),
  };
  return { extractions, plan: planFile('a.tsx', extractions.base, extractions.head, config) };
};

describe('a real library component rendered in place of the stand-in', () => {
  it('marks an element whose tag is imported from the configured source', () => {
    const extraction = extractFile(head(), 'a.tsx', options);
    const [tabs] = extraction.elements;
    expect(tabs.real).toBe(true);
    expect(extraction.prelude).toContain("import { Tabs } from '@lobehub/ui';");
  });

  it('proves a className to classNames move by rendering the real component', () => {
    const { plan } = both(base(), head());
    expect(plan.cases[0].flags).toEqual([]);
    expect(plan.cases[0].evidence).toEqual(['REAL_COMPONENT_RENDERED']);
    expect(plan.cases[0].samples).toEqual([
      { attributes: { 'data-replace-all': '' }, children: [], tag: 'div' },
    ]);
  });

  it('passes the slot object to the real component and adds sample items', () => {
    const { extractions, plan } = both(base(), head());
    const module = generateModule(extractions.head, plan, 'head', {
      layoutComponents: [],
      realComponents,
    });
    expect(module).toContain('classNames={{ list: stylex.props(styles.tabList).className');
    expect(module).toContain("items={[{ key: 'a', label: 'a' }");
    expect(module).toContain('{...{"data-replace-all":""}}');
    expect(module).not.toContain('__neutral("classNames"');
  });

  it('keeps the stand-in for a same-named component from another module', () => {
    const { plan } = both(base('./Tabs'), head('./Tabs'));
    expect(plan.cases[0].flags).toEqual(['PLACEMENT_NEUTRAL_PROP', 'PLACEMENT_SUBSTITUTED']);
    expect(plan.cases[0].evidence).toBeUndefined();
    expect(plan.cases[0].standIns).toEqual({ base: ['Tabs'], head: ['Tabs'] });
  });

  it('records no stand-in when every component on the chain renders for real', () => {
    expect(both(base(), head()).plan.cases[0].standIns).toBeUndefined();
  });

  it('records the stand-ins of an element that exists on one side only', () => {
    const { plan } = both(
      base(undefined, '<div className={styles.tabs} />'),
      head(undefined, '<Select {...stylex.props(styles.tab)} />'),
    );
    expect(plan.standIns).toEqual({ 'head:View#0': ['Select'] });
  });

  it('keeps the stand-in when a leaf component would have to host a styled child', () => {
    const child = (props: string) => `<Tabs className={styles.tabs}><span ${props}>x</span></Tabs>`;
    const { plan } = both(
      base(undefined, child('className={styles.tabs}')),
      head(
        undefined,
        child('{...stylex.props(styles.tab)}').replace(
          'className={styles.tabs}',
          '{...stylex.props(styles.tabList)}',
        ),
      ),
    );
    expect(plan.cases.at(-1)?.flags).toContain('PLACEMENT_SUBSTITUTED');
  });
});
