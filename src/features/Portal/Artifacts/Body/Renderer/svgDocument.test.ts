import { describe, expect, it } from 'vitest';

import { getSvgFrameProps, SVG_PREVIEW_BACKGROUND, toStandaloneSvg } from './svgDocument';

const ANIMATED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>@keyframes spin { to { transform: rotate(360deg); } } .wheel { fill: red; animation: spin 2s infinite; }</style>
  <circle class="wheel" cx="50" cy="50" r="20"><set attributeName="r" to="30" begin="1s" /></circle>
  <foreignObject x="0" y="0" width="100" height="20"><div>Caption</div></foreignObject>
  <script>alert(1)</script>
</svg>`;

describe('getSvgFrameProps', () => {
  it('previews the SVG verbatim inside a script-free sandbox', () => {
    const { sandbox, srcDoc } = getSvgFrameProps(ANIMATED_SVG);

    // An empty sandbox disables scripts, so the <script> above can stay in the document
    expect(sandbox).toBe('');
    expect(srcDoc).toContain(ANIMATED_SVG);
  });

  it('paints a white canvas regardless of the app theme', () => {
    const { srcDoc } = getSvgFrameProps('<svg viewBox="0 0 10 10"></svg>');

    expect(srcDoc).toContain(`background:${SVG_PREVIEW_BACKGROUND}`);
    expect(srcDoc).toContain('color-scheme:light');
  });
});

describe('toStandaloneSvg', () => {
  it('sizes the root svg and serializes it with its namespace', () => {
    const svg = toStandaloneSvg(
      '<svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg>',
      320,
      240,
    );

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="320"');
    expect(svg).toContain('height="240"');
    expect(svg).toContain('<rect');
  });

  it('returns undefined when there is no svg element', () => {
    expect(toStandaloneSvg('<div>not svg</div>', 10, 10)).toBeUndefined();
  });
});
