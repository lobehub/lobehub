import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { globalCssAdapter } from '../extract/adapters/globalCss';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const TOKEN = 'lobe-crumb-30cd-root';

const component = (css = true) => `${css ? "import './crumb.css';\n" : ''}
import { Breadcrumb } from '@lobehub/ui';

import { rootClassName } from './crumbStyles';

export const Crumb = () => <Breadcrumb className={rootClassName} items={[]} />;
`;

const baseModule = `import * as stylex from '@stylexjs/stylex';

const SCOPE = '${TOKEN}';

const crumbStyles = stylex.create({ root: { minWidth: 0 } });

export const rootClassName = [SCOPE, stylex.props(crumbStyles.root).className].join(' ');
`;

const headModule = (
  rule = 'flex-wrap: nowrap;',
  applied = 'fallback.root',
) => `import { createStaticStyles, cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const crumbStyles = stylex.create({ root: { minWidth: 0 } });

const fallback = createStaticStyles(({ css }) => ({
  root: css\`
    ol {
      ${rule}
    }
  \`,
}));

export const rootClassName = cx(stylex.props(crumbStyles.root).className, ${applied});
`;

const options = (module: string, css?: string) => ({
  adapters: [emotionStaticAdapter, stylexAdapter, globalCssAdapter],
  layoutComponents: [],
  readModule: (_from: string, specifier: string) =>
    specifier === './crumbStyles' ? module : undefined,
  readStylesheet: (_from: string, specifier: string) =>
    specifier === './crumb.css' ? css : undefined,
});

const CSS = `.${TOKEN} ol {\n  flex-wrap: nowrap;\n}\n`;

const plan = (head: string) =>
  planFile(
    'a.tsx',
    extractFile(component(), 'a.tsx', options(baseModule, CSS)),
    extractFile(component(false), 'a.tsx', options(head)),
    { layoutComponents: [] },
  ).cases;

describe('a class constant imported from a sibling styles module', () => {
  it('reads the stylesheet class and the fallback through the imported constant', () => {
    const head = extractFile(component(false), 'a.tsx', options(headModule()));
    expect(head.elements[0].slots).toEqual([
      'rootClassName$crumbStyles.root',
      'rootClassName$fallback.root',
    ]);
    expect(head.rules.map((rule) => rule.selector)).toEqual(['.__self__ ol']);
    const base = extractFile(component(), 'a.tsx', options(baseModule, CSS));
    expect(base.elements[0].slots).toContain(`global.${TOKEN}`);
    expect(base.elements[0].flags).toEqual(['INNER_TARGET']);
  });

  it('proves the rule kept verbatim in the sibling module fallback', () => {
    const [entry] = plan(headModule());
    expect(entry.flags).toEqual([]);
    expect(entry.evidence).toEqual(['PLACEMENT_PRESERVED', 'EMOTION_RULE_KEPT']);
    expect(entry.inner).toEqual({ 0: [{ attributes: {}, children: [], tag: 'ol' }] });
  });

  it('keeps the flag when the sibling module changed the declaration', () => {
    const [entry] = plan(headModule('flex-wrap: wrap;'));
    expect(entry.flags).toEqual(['INNER_TARGET']);
  });

  it('keeps the flag when the sibling module no longer applies the fallback', () => {
    const [entry] = plan(headModule(undefined, "''"));
    expect(entry.flags).toEqual(['INNER_TARGET']);
  });
});
