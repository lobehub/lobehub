import { remark } from 'remark';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { describe, expect, it } from 'vitest';

describe.each([false, true])('GFM strong-emphasis boundaries (CJK plugin: %s)', (cjk) => {
  const render = (markdown: string) => {
    const processor = remark();
    if (cjk) processor.use(remarkCjkFriendly);
    return String(
      processor.use(remarkGfm, { singleTilde: false }).use(remarkHtml).processSync(markdown),
    );
  };

  it('keeps the closing emphasis and Chinese annotation outside the PR link', () => {
    expect(render('PR：**https://github.com/example/project/pull/123**（OPEN，base `main`）')).toBe(
      '<p>PR：<strong><a href="https://github.com/example/project/pull/123">https://github.com/example/project/pull/123</a></strong>（OPEN，base <code>main</code>）</p>\n',
    );
  });

  it.each([
    '（备注）',
    '，然后继续',
    '。下一句',
    '；另一项',
    '！完成',
    '？确认',
    '、下一项',
    '“说明”',
    '”然后继续',
    '‘说明’',
    '’然后继续',
    '…下一句',
    '……”然后继续',
  ])('closes directly wrapping strong emphasis before %s', (suffix) => {
    expect(render(`**https://example.com/path**${suffix}`)).toBe(
      `<p><strong><a href="https://example.com/path">https://example.com/path</a></strong>${suffix}</p>\n`,
    );
  });

  it.each([
    'https://zh.wikipedia.org/wiki/三体（小说）',
    'https://en.wikipedia.org/wiki/Schrödinger’s_cat',
    'https://example.com/search?q=你好，世界&lang=zh',
    'https://example。com/path',
    'https://example.com/path?（查询值）',
    'https://example.com/path**（备注）',
    'https://example.com/path…下一句',
  ])('preserves the complete unwrapped URL %s', (url) => {
    const href = encodeURI(url).replaceAll('&', '&#x26;');
    expect(render(url)).toBe(`<p><a href="${href}">${url.replaceAll('&', '&#x26;')}</a></p>\n`);
  });

  it.each(['', ' '])(
    'does not reuse an already closed strong opener (separator: %s)',
    (separator) => {
      expect(render(`**已闭合**${separator}https://example.com/path**（备注）`)).toBe(
        `<p><strong>已闭合</strong>${separator}<a href="https://example.com/path**%EF%BC%88%E5%A4%87%E6%B3%A8%EF%BC%89">https://example.com/path**（备注）</a></p>\n`,
      );
    },
  );

  it('allows a new strong-wrapped URL after already resolved emphasis', () => {
    expect(render('**标题**正文**https://example.com/path**（备注）')).toBe(
      '<p><strong>标题</strong>正文<strong><a href="https://example.com/path">https://example.com/path</a></strong>（备注）</p>\n',
    );
  });

  it('closes multiple strong-wrapped URLs in the same paragraph', () => {
    expect(
      render('**https://example.com/first**（一）正文**https://example.com/second**（二）'),
    ).toBe(
      '<p><strong><a href="https://example.com/first">https://example.com/first</a></strong>（一）正文<strong><a href="https://example.com/second">https://example.com/second</a></strong>（二）</p>\n',
    );
  });

  it('keeps an opener that the rule of three prevents from closing earlier emphasis', () => {
    expect(render('*前文**https://example.com/path**（备注）')).toBe(
      '<p>*前文<strong><a href="https://example.com/path">https://example.com/path</a></strong>（备注）</p>\n',
    );
  });

  it('does not reuse strong delimiters after resolving earlier strikethrough', () => {
    expect(render('~~x**one~~y**z**https://example.com/path**（备注）')).toBe(
      '<p><del>x**one</del>y<strong>z</strong><a href="https://example.com/path**%EF%BC%88%E5%A4%87%E6%B3%A8%EF%BC%89">https://example.com/path**（备注）</a></p>\n',
    );
  });

  it('recognizes a fresh opener after resolving earlier strikethrough', () => {
    expect(render('~~x**one~~y**https://example.com/path**（备注）')).toBe(
      '<p><del>x**one</del>y<strong><a href="https://example.com/path">https://example.com/path</a></strong>（备注）</p>\n',
    );
  });

  it('preserves upstream boundaries when a later strikethrough closer changes attention scope', () => {
    expect(render('~~q~~ **a~~b**c**https://example.com/path**（备注）~~')).toBe(
      '<p><del>q</del> **a<del>b<strong>c</strong><a href="https://example.com/path**%EF%BC%88%E5%A4%87%E6%B3%A8%EF%BC%89">https://example.com/path**（备注）</a></del></p>\n',
    );
  });

  it('recognizes a fresh opener after an explicit link', () => {
    expect(render('[**标题**](https://example.org)正文**https://example.com/path**（备注）')).toBe(
      '<p><a href="https://example.org"><strong>标题</strong></a>正文<strong><a href="https://example.com/path">https://example.com/path</a></strong>（备注）</p>\n',
    );
  });

  it('preserves pending-label fallback instead of creating nested links', () => {
    expect(render('[**https://example.com/path**（备注）](https://example.org)')).toBe(
      '<p><a href="https://example.org"><strong>https://example.com/path</strong>（备注）</a></p>\n',
    );
  });

  it('closes strong after a trailing slash with the active attention tokenizer', () => {
    expect(render('**https://example.com/path/**（备注）')).toBe(
      '<p><strong><a href="https://example.com/path/">https://example.com/path/</a></strong>（备注）</p>\n',
    );
  });

  it.each([
    ['**', '***（备注）'],
    ['***', '**（备注）'],
    ['**前文 ', '**（备注）'],
    ['**', '*（备注）'],
    ['**', '**suffix'],
  ])('does not reinterpret other delimiter contexts: %s URL %s', (prefix, suffix) => {
    const url = `https://example.com/path${suffix}`;
    expect(render(`${prefix}${url}`)).toBe(
      `<p>${prefix}<a href="${encodeURI(url)}">${url}</a></p>\n`,
    );
  });

  it('preserves the existing mdast fallback autolink boundaries', () => {
    expect(render('链接：www.example.com/path（备注）')).toBe(
      '<p>链接：<a href="http://www.example.com/path%EF%BC%88%E5%A4%87%E6%B3%A8%EF%BC%89">www.example.com/path（备注）</a></p>\n',
    );
    expect(render('[https://example.com/path（备注）]')).toBe(
      '<p>[<a href="https://example.com/path%EF%BC%88%E5%A4%87%E6%B3%A8%EF%BC%89">https://example.com/path（备注）</a>]</p>\n',
    );
  });

  it.each(['http://example.com', 'https://example.com', 'www.example.com/path'])(
    'closes strong around %s',
    (url) => {
      expect(render(`**${url}**（备注）`)).toBe(
        `<p><strong><a href="${url.startsWith('www.') ? 'http://' : ''}${url}">${url}</a></strong>（备注）</p>\n`,
      );
    },
  );

  it('preserves punctuation inside a strongly wrapped URL', () => {
    expect(render('**https://example.com/path?（查询值）**（备注）')).toBe(
      '<p><strong><a href="https://example.com/path?%EF%BC%88%E6%9F%A5%E8%AF%A2%E5%80%BC%EF%BC%89">https://example.com/path?（查询值）</a></strong>（备注）</p>\n',
    );
  });

  it('preserves Unicode paths and balanced ASCII parentheses', () => {
    expect(render('https://example.com/中文_(page)?a=1&b=2')).toBe(
      '<p><a href="https://example.com/%E4%B8%AD%E6%96%87_(page)?a=1&#x26;b=2">https://example.com/中文_(page)?a=1&#x26;b=2</a></p>\n',
    );
    expect(render('https://example.com/a–b')).toBe(
      '<p><a href="https://example.com/a%E2%80%93b">https://example.com/a–b</a></p>\n',
    );
  });

  it('preserves punctuation explicitly included in link destinations', () => {
    expect(render('[文档](https://example.com/中文（说明）)')).toBe(
      '<p><a href="https://example.com/%E4%B8%AD%E6%96%87%EF%BC%88%E8%AF%B4%E6%98%8E%EF%BC%89">文档</a></p>\n',
    );
    expect(render('https://example.com/a%EF%BC%88b%EF%BC%89')).toBe(
      '<p><a href="https://example.com/a%EF%BC%88b%EF%BC%89">https://example.com/a%EF%BC%88b%EF%BC%89</a></p>\n',
    );
    expect(render('[文档](https://example.com/a…b)')).toBe(
      '<p><a href="https://example.com/a%E2%80%A6b">文档</a></p>\n',
    );
  });

  it('leaves inline and fenced code unchanged', () => {
    const content = '**https://example.com/path**（备注）';
    expect(render(`\`${content}\`\n\n\`\`\`text\n${content}\n\`\`\``)).toBe(
      `<p><code>${content}</code></p>\n<pre><code class="language-text">${content}\n</code></pre>\n`,
    );
  });
});
