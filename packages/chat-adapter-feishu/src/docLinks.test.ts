import { describe, expect, it } from 'vitest';

import { extractLarkDocLinks, flattenLarkMessageContent, parseLarkDocUrl } from './docLinks';

describe('parseLarkDocUrl', () => {
  it('extracts the token from a docx link and ignores query / fragment', () => {
    expect(
      parseLarkDocUrl('https://lobe-hub.feishu.cn/docx/Abc123DefGhi456?from=chat#heading'),
    ).toEqual({
      host: 'lobe-hub.feishu.cn',
      kind: 'docx',
      token: 'Abc123DefGhi456',
      url: 'https://lobe-hub.feishu.cn/docx/Abc123DefGhi456',
    });
  });

  it.each([
    ['https://x.larksuite.com/wiki/WikiTok3n', 'wiki', 'WikiTok3n'],
    ['https://x.feishu.cn/docs/legacyDocTok', 'doc', 'legacyDocTok'],
    ['https://x.feishu.cn/minutes/obcn1234', 'minutes', 'obcn1234'],
    ['https://x.feishu.cn/sheets/shtcn1234', 'sheets', 'shtcn1234'],
    ['https://x.feishu.cn/base/bascn1234', 'base', 'bascn1234'],
    ['http://x.larkoffice.com/file/boxcn1234', 'file', 'boxcn1234'],
  ])('recognises %s as %s', (url, kind, token) => {
    expect(parseLarkDocUrl(url)).toMatchObject({ kind, token });
  });

  it('rejects non-document and non-Feishu URLs', () => {
    expect(parseLarkDocUrl('https://lobe-hub.feishu.cn/space/home')).toBeUndefined();
    expect(parseLarkDocUrl('https://docs.google.com/document/d/abc')).toBeUndefined();
    expect(parseLarkDocUrl('docx/Abc123')).toBeUndefined();
    expect(parseLarkDocUrl('see https://x.feishu.cn/docx/Abc123')).toBeUndefined();
  });
});

describe('extractLarkDocLinks', () => {
  it('finds every distinct document link in free text, in order', () => {
    const text = [
      '会议纪要 https://lobe-hub.feishu.cn/docx/AAA?from=chat 和',
      'https://lobe-hub.feishu.cn/wiki/BBB ，再看一次 https://lobe-hub.feishu.cn/docx/AAA',
    ].join(' ');
    expect(extractLarkDocLinks(text).map((l) => `${l.kind}:${l.token}`)).toEqual([
      'docx:AAA',
      'wiki:BBB',
    ]);
  });

  it('returns an empty list when there is nothing to find', () => {
    expect(extractLarkDocLinks('hello https://example.com')).toEqual([]);
  });
});

describe('flattenLarkMessageContent', () => {
  it('returns the text and its links for a text message', () => {
    const result = flattenLarkMessageContent(
      'text',
      JSON.stringify({ text: '看下 https://lobe-hub.feishu.cn/docx/AAA' }),
    );
    expect(result.text).toBe('看下 https://lobe-hub.feishu.cn/docx/AAA');
    expect(result.links).toEqual(['https://lobe-hub.feishu.cn/docx/AAA']);
    expect(result.imageKeys).toEqual([]);
  });

  it('renders a post (rich text) receive-event body with its anchors', () => {
    const content = {
      content: [
        [
          { tag: 'at', user_id: 'ou_bot', user_name: 'LobeHub CAO' },
          { tag: 'text', text: ' 帮我看这份纪要 ' },
          { href: 'https://lobe-hub.feishu.cn/docx/AAA', tag: 'a', text: '远程设备研讨会' },
        ],
        [{ tag: 'img', image_key: 'img_1' }],
      ],
      title: '智能纪要',
    };
    const result = flattenLarkMessageContent('post', JSON.stringify(content));
    expect(result.text).toBe(
      '智能纪要\n@LobeHub CAO 帮我看这份纪要 远程设备研讨会 (https://lobe-hub.feishu.cn/docx/AAA)\n[image]',
    );
    expect(result.links).toEqual(['https://lobe-hub.feishu.cn/docx/AAA']);
    expect(result.imageKeys).toEqual(['img_1']);
  });

  it('prefers content_v2 and extracts Feishu image keys from native markdown in order', () => {
    const content = {
      content: [[{ tag: 'img', image_key: 'img_legacy' }]],
      content_v2: [
        [{ tag: 'md', text: '第一段 ![截图](img_v3_first)' }],
        [],
        [
          { tag: 'text', text: '第二段' },
          { tag: 'img', image_key: 'img_v3_second' },
          { tag: 'md', text: ' ![外链](https://example.com/image.png)' },
        ],
      ],
      title: '标题',
    };

    const result = flattenLarkMessageContent('post', JSON.stringify(content));

    expect(result.text).toBe(
      '标题\n第一段 [image]\n\n第二段[image] ![外链](https://example.com/image.png)',
    );
    expect(result.imageKeys).toEqual(['img_v3_first', 'img_v3_second']);
  });

  it('unwraps locale-keyed content_v2 post bodies', () => {
    const content = {
      zh_cn: {
        content_v2: [[{ tag: 'img', image_key: 'img_locale' }]],
        title: '本地化标题',
      },
    };
    const result = flattenLarkMessageContent('post', content);

    expect(result.text).toBe('本地化标题\n[image]');
    expect(result.imageKeys).toEqual(['img_locale']);
  });

  it.each([undefined, [], null, 'invalid'])(
    'falls back to classic content for unusable v2: %s',
    (content_v2) => {
      const result = flattenLarkMessageContent('post', {
        content: [
          [
            { tag: 'text', text: 'classic' },
            { tag: 'img', image_key: 'img_classic' },
          ],
        ],
        content_v2,
      });
      expect(result.text).toBe('classic[image]');
      expect(result.imageKeys).toEqual(['img_classic']);
    },
  );

  it('does not download markdown examples or external images', () => {
    const result = flattenLarkMessageContent('post', {
      content_v2: [
        [
          {
            tag: 'md',
            text: '`![example](img_code)`\n```md\n![example](img_fenced)\n```\n![remote](https://example.com/a.png)\n![real](img_real)',
          },
        ],
      ],
    });
    expect(result.imageKeys).toEqual(['img_real']);
    expect(result.text).toBe(
      '`![example](img_code)`\n```md\n![example](img_fenced)\n```\n![remote](https://example.com/a.png)\n[image]',
    );
  });

  it('keeps escaped image syntax and code spans with arbitrary backtick delimiters', () => {
    const text = '\\![escaped](img_escaped) ````![code](img_code)```` ![real](img_real)';
    const result = flattenLarkMessageContent('post', {
      content_v2: [[{ tag: 'md', text }]],
    });

    expect(result.imageKeys).toEqual(['img_real']);
    expect(result.text).toBe('\\![escaped](img_escaped) ````![code](img_code)```` [image]');
  });

  it.each(['![', '![](!'])('handles repeated incomplete image syntax: %s', (prefix) => {
    const text = prefix.repeat(30_000);
    const started = performance.now();
    const result = flattenLarkMessageContent('post', {
      content_v2: [[{ tag: 'md', text }]],
    });

    expect(result.imageKeys).toEqual([]);
    expect(result.text).toBe(text);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('unwraps a locale-keyed post body', () => {
    const content = {
      zh_cn: { content: [[{ tag: 'text', text: 'hello' }]], title: 'T' },
    };
    expect(flattenLarkMessageContent('post', content).text).toBe('T\nhello');
  });

  it('harvests text and urls from an interactive card', () => {
    const card = {
      elements: [
        { tag: 'div', text: { content: '**参会人**：A、B', tag: 'lark_md' } },
        {
          actions: [
            {
              tag: 'button',
              text: { content: '查看纪要', tag: 'plain_text' },
              url: 'https://lobe-hub.feishu.cn/docx/CCC',
            },
          ],
          tag: 'action',
        },
      ],
      header: { title: { content: '9/9 多Agent协作方案评审会', tag: 'plain_text' } },
    };
    const result = flattenLarkMessageContent('interactive', JSON.stringify(card));
    expect(result.text).toBe(
      '**参会人**：A、B\n查看纪要\n9/9 多Agent协作方案评审会\n[links: https://lobe-hub.feishu.cn/docx/CCC]',
    );
    expect(result.links).toEqual(['https://lobe-hub.feishu.cn/docx/CCC']);
  });

  it('keeps malformed content as-is instead of throwing', () => {
    const result = flattenLarkMessageContent('text', 'not json https://x.feishu.cn/docx/DDD');
    expect(result.text).toBe('not json https://x.feishu.cn/docx/DDD');
    expect(result.links).toEqual(['https://x.feishu.cn/docx/DDD']);
  });

  it('surfaces only the file name for media bodies', () => {
    expect(
      flattenLarkMessageContent('file', JSON.stringify({ file_key: 'f', file_name: 'a.pdf' })),
    ).toEqual({ imageKeys: [], links: [], text: '[file] a.pdf' });
    expect(flattenLarkMessageContent('image', JSON.stringify({ image_key: 'i' }))).toEqual({
      imageKeys: [],
      links: [],
      text: '',
    });
  });
});
