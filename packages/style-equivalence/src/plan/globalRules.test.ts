import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { globalCssAdapter } from '../extract/adapters/globalCss';
import { extractFile } from '../extract/index';
import type { ExtractOptions } from '../extract/types';
import { carriedClasses, globalRulesChanged } from './globalRules';

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

const gaps = (
  before: string,
  after: string,
  css: ExtractOptions['readStylesheet'] = options.readStylesheet,
) => {
  const read = { ...options, readStylesheet: css };
  const pair = [extractFile(before, 'a.tsx', read), extractFile(after, 'a.tsx', options)] as const;
  const gap = globalRulesChanged(pair[0], pair[1], carriedClasses([...pair]));
  return gap ? [gap] : [];
};

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

  it('leaves rules on a class an element carries to the element cases', () => {
    const css = () => '.crumb ol { margin: 0; }\n';
    const element = `import './Highlight.css';\n\nexport const A = () => <div className="crumb" />;\n`;
    expect(gaps(element, 'export const A = () => <div className="crumb" />;\n', css)).toEqual([]);
  });

  it('still compares a rule whose class no element carries', () => {
    const css = () => '[data-submenu] > [role="menu"]:has(.lobe-skill-search) { width: 1px; }\n';
    const element = `import './Highlight.css';\n\nexport const A = () => <div />;\n`;
    expect(gaps(element, 'export const A = () => <div />;\n', css)).toEqual([
      'GLOBAL_RULES_CHANGED:1/0',
    ]);
  });

  it('leaves a class the file writes outside JSX to the outside-JSX flag', () => {
    const css = () => '.lobe-input-38d9-editor p { margin: 0; }\n';
    const outside = `import './Highlight.css';\n\nconst className = \`\${'lobe-input-38d9-editor'}\`;\nexport const A = () => <div />;\n`;
    expect(gaps(outside, 'export const A = () => <div />;\n', css)).toEqual([]);
  });
});
