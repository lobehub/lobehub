import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { globalCssAdapter } from '../extract/adapters/globalCss';
import { extractFile } from '../extract/index';
import { planFile } from './planFile';

const CSS = `::highlight(lobe-comment) {
  text-decoration-color: var(--lobe-color-warning);
  text-underline-offset: 3px;
}

::highlight(lobe-comment-active) {
  background-color: var(--lobe-color-warning-border);
}
`;

const REGISTRY = `export const REGISTRY = { active: 'lobe-comment-active', all: 'lobe-comment' } as const;\n`;

const base = `import './Highlight.css';

const HighlightStyle = () => null;

export default HighlightStyle;
`;

const head = (
  offset = '3px',
  active = `::highlight(\${REGISTRY.active}) {
    background-color: \${cssVar.colorWarningBorder};
  }`,
) => `import { createGlobalStyle, cssVar } from '@lobehub/ui';

import { REGISTRY } from './highlights';

const HighlightStyle = createGlobalStyle\`
  ::highlight(\${REGISTRY.all}) {
    text-decoration-color: \${cssVar.colorWarning};
    text-underline-offset: ${offset};
  }

  ${active}
\`;

export default HighlightStyle;
`;

const options = {
  adapters: [emotionStaticAdapter, globalCssAdapter],
  layoutComponents: [],
  readModule: (_from: string, specifier: string) =>
    specifier === './highlights' ? REGISTRY : undefined,
  readStylesheet: (_from: string, specifier: string) =>
    specifier === './Highlight.css' ? CSS : undefined,
};

const gaps = (before: string, after: string) =>
  planFile('a.tsx', extractFile(before, 'a.tsx', options), extractFile(after, 'a.tsx', options), {
    layoutComponents: [],
  }).gaps;

describe('global rules that hang on no element', () => {
  it('proves a global stylesheet restored verbatim into createGlobalStyle', () => {
    expect(gaps(base, head())).toEqual([]);
  });

  it('catches a changed declaration', () => {
    expect(gaps(base, head('4px'))).toEqual(['GLOBAL_RULES_CHANGED:1/1']);
  });

  it('catches a dropped rule', () => {
    expect(gaps(base, head(undefined, ''))).toEqual(['GLOBAL_RULES_CHANGED:1/0']);
  });

  it('catches a changed global style kept in emotion on both sides', () => {
    expect(gaps(head(), head())).toEqual([]);
    expect(gaps(head(), head(undefined, ''))).toEqual(['GLOBAL_RULES_CHANGED:1/0']);
  });

  it('leaves stylesheet rules on classes an element carries to the element cases', () => {
    const withElement = `import './Highlight.css';\n\nexport const A = () => <div className="crumb" />;\n`;
    const css = '.crumb ol { margin: 0; }\n';
    const extraction = extractFile(withElement, 'a.tsx', {
      ...options,
      readStylesheet: () => css,
    });
    const empty = extractFile(
      'export const A = () => <div className="crumb" />;\n',
      'a.tsx',
      options,
    );
    expect(planFile('a.tsx', extraction, empty, { layoutComponents: [] }).gaps).toEqual([]);
  });
});
