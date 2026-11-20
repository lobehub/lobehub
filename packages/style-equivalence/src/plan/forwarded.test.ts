import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import type { RealComponent } from '../extract/types';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const realComponents: Record<string, RealComponent> = {
  Text: { source: '@lobehub/ui', tag: { default: 'div', prop: 'as' } },
};

const component = (title: string) => `
import { createStaticStyles, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Heading } from './Heading';

const styles = createStaticStyles(({ css }) => ({ titleRow: css\`gap: 10px;\` }));

const AcceptanceIdentity = ({ titleXstyle }) => {
  const { data } = useBundle();
  if (!data) return null;
  return (
    <Flexbox gap={10}>
      <Flexbox horizontal className={styles.titleRow}>
        ${title}
      </Flexbox>
      <PullRequestLinks />
    </Flexbox>
  );
};

export default AcceptanceIdentity;
`;

const TEXT = `<Text ellipsis as={'h1'} style={{ fontSize: 18, margin: 0 }}>{data.title}</Text>`;
const FORWARDED = `<Text ellipsis as={'h1'} className={stylex.props(titleXstyle).className} style={{ fontSize: 18, margin: 0 }}>{data.title}</Text>`;

const caller = {
  base: (rule = 'h1 { overflow: visible; white-space: normal; }') => `
import { createStaticStyles, Flexbox } from '@lobehub/ui';
import AcceptanceIdentity from './AcceptanceIdentity';

const styles = createStaticStyles(({ css }) => ({
  content: css\`
    width: 100%;
    ${rule}
  \`,
}));

export const EmbedContent = () => (
  <Flexbox className={styles.content} gap={24}>
    <AcceptanceIdentity />
    <AcceptanceGoal />
  </Flexbox>
);
`,
  head: () => `
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import AcceptanceIdentity from './AcceptanceIdentity';

const styles = stylex.create({
  content: { width: '100%' },
  title: { overflow: 'visible', whiteSpace: 'normal' },
});

export const EmbedContent = () => (
  <Flexbox className={stylex.props(styles.content).className} gap={24}>
    <AcceptanceIdentity titleXstyle={styles.title} />
    <AcceptanceGoal />
  </Flexbox>
);
`,
};

const options = (modules: { base: string; head: string }) => ({
  adapters: [emotionStaticAdapter, stylexAdapter],
  layoutComponents: ['Flexbox'],
  readBaseModule: (_from: string, specifier: string) =>
    specifier === './AcceptanceIdentity' ? modules.base : undefined,
  readModule: (_from: string, specifier: string) =>
    specifier === './AcceptanceIdentity' ? modules.head : undefined,
  realComponents,
});

const config = { layoutComponents: ['Flexbox'], realComponents };

const callerPlan = (
  modules = { base: component(TEXT), head: component(FORWARDED) },
  rule?: string,
) => {
  const extractions = {
    base: extractFile(caller.base(rule), 'a.tsx', options(modules)),
    head: extractFile(caller.head(), 'a.tsx', options(modules)),
  };
  return { extractions, plan: planFile('a.tsx', extractions.base, extractions.head, config) };
};

describe('a style forwarded into our own component, seen from the caller', () => {
  it('pairs the forwarded prop with the plain child the descendant rule targeted', () => {
    const { plan } = callerPlan();
    expect(plan.unpaired).toEqual([]);
    const forwarded = plan.cases.find((entry) => entry.forward)!;
    expect(forwarded.elementIds).toEqual({ base: 'EmbedContent#0/0', head: 'EmbedContent#1' });
    expect(forwarded.flags).toEqual([]);
    expect(forwarded.evidence).toEqual(['FORWARDED_RENDERED']);
    expect(forwarded.forward).toMatchObject({
      application: 'props',
      base: { attributes: { as: 'h1', ellipsis: true }, tag: 'Text' },
      head: { attributes: { as: 'h1', ellipsis: true }, tag: 'Text' },
      prop: 'titleXstyle',
    });
  });

  it('keeps the parent flagged and names the components it did not prove', () => {
    const { plan } = callerPlan();
    expect(plan.cases[0].flags).toEqual([
      'INNER_TARGET',
      'INNER_TARGET_PARTLY_FORWARDED:h1|AcceptanceGoal,AcceptanceIdentity',
    ]);
  });

  it('renders the real target element with the forwarded class on the head side', () => {
    const { extractions, plan } = callerPlan();
    const head = generateModule(extractions.head, plan, 'head', config);
    const base = generateModule(extractions.base, plan, 'base', config);
    expect(head).toContain('import { Text as __forward_Text } from "@lobehub/ui";');
    expect(head).toContain('className={__stylex.props(styles.title).className}');
    expect(head).toMatch(
      /<__forward_Text data-synthetic-element="EmbedContent#1" ellipsis=\{true\} as="h1"/,
    );
    expect(base).toMatch(
      /<__forward_Text data-synthetic-element="EmbedContent#0\/0" ellipsis=\{true\} as="h1"/,
    );
    expect(base).not.toContain('__stylex.props');
  });

  it('leaves the child unpaired when the component applies the prop twice', () => {
    const { plan } = callerPlan({
      base: component(TEXT),
      head: component(`${FORWARDED}<h2 className={stylex.props(titleXstyle).className} />`),
    });
    expect(plan.unpaired).toEqual([{ elementId: 'EmbedContent#1', side: 'head' }]);
    expect(plan.cases[0].flags).toEqual(['INNER_TARGET']);
  });

  it('leaves the child unpaired when the base rule only reaches direct children', () => {
    const { plan } = callerPlan(undefined, '> h1 { overflow: visible; }');
    expect(plan.unpaired).toEqual([{ elementId: 'EmbedContent#1', side: 'head' }]);
  });

  it('leaves the child unpaired when the target is rendered by yet another own component', () => {
    const heading = (props: string) => `<Heading as={'h1'} ${props}>{data.title}</Heading>`;
    const { plan } = callerPlan({
      base: component(heading('')),
      head: component(heading('className={stylex.props(titleXstyle).className}')),
    });
    expect(plan.unpaired).toEqual([{ elementId: 'EmbedContent#1', side: 'head' }]);
  });

  it('leaves the child unpaired when the base selector is not a plain descendant', () => {
    const { plan } = callerPlan(undefined, '&:hover h1 { overflow: visible; }');
    expect(plan.unpaired).toEqual([{ elementId: 'EmbedContent#1', side: 'head' }]);
  });
});

describe('a style forwarded into our own component, seen from inside', () => {
  const inside = (head: string) => {
    const extract = (code: string) =>
      extractFile(code, 'Identity.tsx', {
        adapters: [emotionStaticAdapter, stylexAdapter],
        layoutComponents: ['Flexbox'],
        realComponents,
      });
    return planFile('Identity.tsx', extract(component(TEXT)), extract(head), config);
  };

  it('pairs the element with its plain counterpart and renders it with the prop absent', () => {
    const plan = inside(component(FORWARDED));
    expect(plan.unpaired).toEqual([]);
    const entry = plan.cases.find((item) => item.forwardedParam)!;
    expect(entry.elementIds).toEqual({
      base: 'AcceptanceIdentity#0/0',
      head: 'AcceptanceIdentity#1',
    });
    expect(entry.flags).toEqual([]);
    expect(entry.variables).toEqual([]);
    expect(entry.evidence).toEqual(['FORWARDED_PROP_ABSENT', 'REAL_COMPONENT_RENDERED']);
  });

  it('leaves the element unpaired when the prop is applied under a condition', () => {
    const plan = inside(component(`{data.ok && ${FORWARDED}}`));
    expect(plan.unpaired).toEqual([{ elementId: 'AcceptanceIdentity#1', side: 'head' }]);
  });

  it('leaves the element unpaired when the prop has a default', () => {
    const plan = inside(
      component(FORWARDED).replace('({ titleXstyle })', '({ titleXstyle = styles.titleRow })'),
    );
    expect(plan.unpaired).toEqual([{ elementId: 'AcceptanceIdentity#1', side: 'head' }]);
  });
});
