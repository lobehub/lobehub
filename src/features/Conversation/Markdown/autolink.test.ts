import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { describe, expect, it } from 'vitest';

const render = (markdown: string) =>
  String(remark().use(remarkGfm, { singleTilde: false }).use(remarkHtml).processSync(markdown));

describe('GFM autolink CJK boundaries', () => {
  it('keeps the closing emphasis and Chinese annotation outside the PR link', () => {
    expect(render('PR：**https://github.com/example/project/pull/123**（OPEN，base `main`）')).toBe(
      '<p>PR：<strong><a href="https://github.com/example/project/pull/123">https://github.com/example/project/pull/123</a></strong>（OPEN，base <code>main</code>）</p>\n',
    );
  });

  it.each(['（备注）', '，然后继续', '。下一句', '；另一项', '！完成', '？确认', '、下一项'])(
    'ends bare links before %s',
    (suffix) => {
      expect(render(`https://example.com/path${suffix}`)).toBe(
        `<p><a href="https://example.com/path">https://example.com/path</a>${suffix}</p>\n`,
      );
    },
  );

  it('preserves Unicode paths and balanced ASCII parentheses', () => {
    expect(render('https://example.com/中文_(page)?a=1&b=2')).toBe(
      '<p><a href="https://example.com/%E4%B8%AD%E6%96%87_(page)?a=1&#x26;b=2">https://example.com/中文_(page)?a=1&#x26;b=2</a></p>\n',
    );
  });

  it('preserves punctuation explicitly included in link destinations', () => {
    expect(render('[文档](https://example.com/中文（说明）)')).toBe(
      '<p><a href="https://example.com/%E4%B8%AD%E6%96%87%EF%BC%88%E8%AF%B4%E6%98%8E%EF%BC%89">文档</a></p>\n',
    );
    expect(render('https://example.com/a%EF%BC%88b%EF%BC%89')).toBe(
      '<p><a href="https://example.com/a%EF%BC%88b%EF%BC%89">https://example.com/a%EF%BC%88b%EF%BC%89</a></p>\n',
    );
  });

  it('leaves inline and fenced code unchanged', () => {
    const content = '**https://example.com/path**（备注）';
    expect(render(`\`${content}\`\n\n\`\`\`text\n${content}\n\`\`\``)).toBe(
      `<p><code>${content}</code></p>\n<pre><code class="language-text">${content}\n</code></pre>\n`,
    );
  });
});
