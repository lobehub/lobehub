import { describe, expect, it } from 'vitest';

import { REMOTE_IMAGE_ATTRIBUTE, sanitizeMailCss, sanitizeMailHtml } from '../mailHtml';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/**
 * Anything left in sanitized output that a browser could turn into a request:
 * a fetching function or at-rule, other than the inline raster kept on purpose.
 */
const FETCHES =
  /(?:url|image-set|image|cross-fade|element|src|attr|expression)\s*\(|@import|@font-face|\\/i;
const fetches = (css: string) => FETCHES.test(css.replaceAll(`url(${PNG})`, ''));

describe('sanitizeMailHtml', () => {
  it('drops scripts, event handlers and active elements', () => {
    const result = sanitizeMailHtml(
      `<p onclick="x()">hi</p><script>alert(1)</script><iframe src="https://a.test"></iframe><form action="https://a.test"><input name="q">kept</form><svg onload="x()"></svg>`,
    )!;

    expect(result.html).not.toMatch(/script|onclick|iframe|<form|<input|svg/i);
    expect(result.html).toContain('hi');
    expect(result.html).toContain('kept');
  });

  it('holds remote images back and reports them', () => {
    const result = sanitizeMailHtml(
      `<img onerror="x()" src="https://track.test/p.gif" width="1"><img src="${PNG}">`,
    )!;

    expect(result.hasRemoteContent).toBe(true);
    expect(result.html).toContain(`${REMOTE_IMAGE_ATTRIBUTE}="https://track.test/p.gif"`);
    expect(result.html).not.toContain(' src="https://track.test');
    expect(result.html).not.toContain('onerror');
    expect(result.html).toContain(`src="${PNG}"`);
  });

  it('drops image sources that are neither remote nor an inline raster', () => {
    const { html } = sanitizeMailHtml(
      `<img src="cid:logo"><img src="/local.png"><img src="data:image/svg+xml,<svg onload=x()>"><img src="javascript:x()">`,
    )!;

    expect(html).not.toMatch(/src=|cid:|local\.png|svg|javascript/i);
  });

  it('deletes remote CSS instead of reporting it', () => {
    const result = sanitizeMailHtml(
      `<html><head><style>@import url(https://evil.test/x.css); p{color:red} .a{background:url(https://evil.test/a.png)}</style></head><body><div style="background:url(https://evil.test/p.png);color:blue">x</div></body></html>`,
    )!;

    expect(fetches(result.html)).toBe(false);
    expect(result.html).not.toContain('evil.test');
    expect(result.html).toContain('color:red');
    expect(result.html).toContain('color:blue');
    // Nothing the reader could load is left, so nothing is offered.
    expect(result.hasRemoteContent).toBe(false);
  });

  it('removes the style attribute when nothing of it is left', () => {
    const { html } = sanitizeMailHtml(
      `<p style="background:url(https://evil.test/p.png)">x</p><p style="/* */">y</p>`,
    )!;

    expect(html).toBe('<p style="background: none">x</p><p>y</p>');
  });

  it('cannot close its style element through an escape', () => {
    const { html } = sanitizeMailHtml(
      `<style>p{color:red}\\3c /style\\3e \\3c img src=x onerror=alert(1)\\3e </style><p>ok</p>`,
    )!;

    expect(html.match(/<\/style>/g)).toHaveLength(1);
    // What the escape spelled stays inert text inside the one stylesheet.
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('<p>ok</p>');
  });

  it('removes comments, conditional comments included', () => {
    const { html } = sanitizeMailHtml(
      `<p>a</p><!--[if mso]><v:image src="https://evil.test/x.png"/><![endif]--><!-- secret -->`,
    )!;

    expect(html).toBe('<p>a</p>');
  });

  it('opens links safely and removes unsafe schemes', () => {
    const { html } = sanitizeMailHtml(
      `<a href="https://ok.test">a</a><a href=" java\tscript:alert(1)">b</a><a href="data:text/html,x">c</a>`,
    )!;

    expect(html).toContain('href="https://ok.test"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/javascript|data:text/i);
  });

  it('refuses oversized mail', () => {
    expect(sanitizeMailHtml('x'.repeat(3 * 1024 * 1024))).toBeNull();
  });

  it('reports no remote content for a plain mail', () => {
    expect(sanitizeMailHtml('<p>hello</p>')).toEqual({
      hasRemoteContent: false,
      html: '<p>hello</p>',
    });
  });
});

describe('sanitizeMailCss', () => {
  it.each([
    ['url()', 'a{background:url(https://evil.test/a.png)}'],
    ['quoted url()', `a{background:url( "https://evil.test/a.png" )}`],
    ['protocol-relative url()', 'a{background:url(//evil.test/a.png)}'],
    ['relative url()', 'a{background:url(/track?id=1)}'],
    ['upper-case URL()', 'a{background:URL(https://evil.test/a.png)}'],
    ['list-style-image', 'li{list-style-image:url(https://evil.test/a.png)}'],
    ['cursor', 'a{cursor:url(https://evil.test/c.cur),auto}'],
    ['border-image', 'a{border-image:url("https://evil.test/b.png") 30}'],
    [
      'image-set()',
      `a{background:image-set("https://evil.test/1x.png" 1x, "https://evil.test/2x.png" 2x)}`,
    ],
    ['-webkit-image-set()', `a{background:-webkit-image-set(url(https://evil.test/a.png) 1x)}`],
    ['image()', `a{background:image("https://evil.test/a.png")}`],
    ['cross-fade()', `a{background:cross-fade(url(https://evil.test/a.png), red 50%)}`],
    ['src()', `a{background:src("https://evil.test/a.png")}`],
    ['attr() reading a held-back image', `img{content:attr(data-lobe-remote-src url)}`],
    ['expression()', `a{width:expression(fetch("https://evil.test"))}`],
    ['@import url()', `@import url(https://evil.test/x.css);a{color:red}`],
    ['@import string', `@import "https://evil.test/x.css";a{color:red}`],
    ['@import with ; inside its string', `@import "https://evil.test/a;b.css" screen;a{color:red}`],
    ['@import without a semicolon', `@import 'https://evil.test/x.css'`],
    ['@IMPORT upper-case', `@IMPORT url(https://evil.test/x.css);`],
    [
      '@font-face remote src',
      `@font-face{font-family:x;src:url(https://evil.test/f.woff2) format("woff2")}a{color:red}`,
    ],
    ['@font-face local + remote', `@font-face{src:local(x),url("//evil.test/f.woff")}a{color:red}`],
    ['hex-escaped url', 'a{background:\\75 rl(https://evil.test/a.png)}'],
    ['six-digit escape', 'a{background:\\000075rl(https://evil.test/a.png)}'],
    ['char-escaped url', 'a{background:u\\rl(https://evil.test/a.png)}'],
    ['escaped @import', '@\\69mport url(https://evil.test/x.css);'],
    ['escaped @font-face', '@font-\\66 ace{src:url(https://evil.test/f.woff)}'],
    ['double escape spelling a new escape', 'a{background:\\\\75 rl(https://evil.test/a.png)}'],
    ['escaped image-set', 'a{background:image-\\73 et("https://evil.test/a.png" 1x)}'],
    ['comment splitting url', 'a{background:u/**/rl(https://evil.test/a.png)}'],
    ['url in a comment-joined at-rule', '@im/**/port url(https://evil.test/x.css);'],
    ['nested url', 'a{background:url(url(https://evil.test/a.png))}'],
    ['unclosed url', 'a{background:url(https://evil.test/a.png'],
    [
      'data: svg (not a raster)',
      `a{background:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><image href='https://evil.test'/></svg>")}`,
    ],
    [
      'data image hiding a second url',
      `a{background:url(${PNG}"x) ; b{background:url(https://evil.test/a.png) ")}`,
    ],
    ['data image with a paren in it', `a{background:url(${PNG}) url(https://evil.test/b.png)}`],
  ])('removes %s', (_, css) => {
    expect(fetches(sanitizeMailCss(css))).toBe(false);
  });

  it('keeps ordinary rules around what it removes', () => {
    expect(sanitizeMailCss('@import url(https://evil.test/x.css); p{color:red}')).toBe(
      ' p{color:red}',
    );
    expect(sanitizeMailCss('a{background:url(https://evil.test/a.png) no-repeat;color:red}')).toBe(
      'a{background: none  no-repeat;color:red}',
    );
  });

  it('keeps an inline raster image', () => {
    expect(sanitizeMailCss(`a{background:url(${PNG})}`)).toBe(`a{background:url(${PNG})}`);
    expect(sanitizeMailCss(`a{background:url("${PNG}")}`)).toBe(`a{background:url("${PNG}")}`);
  });

  it('cannot spell a closing style tag', () => {
    expect(sanitizeMailCss('\\3c /style\\3e')).not.toContain('<');
    expect(sanitizeMailCss('</style>')).not.toContain('<');
  });
});
