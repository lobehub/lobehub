import katex from 'katex';

// The KaTeX stylesheet is injected at a fixed version by @lobehub/ui's ThemeProvider
// (src/ThemeProvider/ThemeProvider.tsx → genCdnUrl({ pkg: 'katex', version: '0.18.1' })).
// This repo must resolve the *renderer* to the same 0.18.x, enforced by the pnpm override
// `katex: ^0.18.1` in pnpm-workspace.yaml.
//
// Without that override, remark-math@6 → micromark-extension-math@3.1.0 hard-resolves
// katex to ^0.16 (0.16.47). The renderer then emits pre-0.18 class names (`.sizing`,
// `.base`) that the 0.18 stylesheet no longer styles — breaking subscripts and large
// operators exactly as reported. This test guards against that drift being reintroduced
// by future dependency changes.
const LOADED_CSS_VERSION = '0.18.1';
const loadedMajorMinor = LOADED_CSS_VERSION.split('.').slice(0, 2).join('.');

describe('katex renderer / stylesheet alignment', () => {
  it('resolves a katex version matching the stylesheet @lobehub/ui loads', () => {
    // Tolerate 0.18.x patch bumps (caret range) but fail if resolution drifts to 0.16.x.
    expect(katex.version.startsWith(`${loadedMajorMinor}.`)).toBe(true);
  });

  it('renders subscripts and large operators with v0.18 class names', () => {
    const html = katex.renderToString('x_i^2 + \\iint_{\\Sigma} f(x,y)\\,dx\\,dy', {
      displayMode: true,
      throwOnError: false,
    });

    // v0.18 prefixes its internal classes (`katex-sizing`, `katex-base`); v0.16 emitted
    // bare `sizing`/`base` classes that the 0.18 stylesheet no longer matches.
    expect(html).toContain('katex-sizing');
    expect(html).not.toMatch(/\bclass="sizing\b/);
  });
});
