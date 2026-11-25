import { describe, expect, it } from 'vitest';

import { extractLinkPreviewUrls, MAX_LINK_PREVIEWS } from './linkPreviewUrls';

describe('extractLinkPreviewUrls', () => {
  it('finds bare and Markdown links in order, without repeats or trailing punctuation', () => {
    const content = [
      '@Cook 看看 https://ryugi.innei.dev/a/2CWv3qrwa7PuQOrqnLJ9Q?page=audit.',
      'And [the docs](https://lobehub.example.com/docs), **https://example.com/x**',
      'again https://ryugi.innei.dev/a/2CWv3qrwa7PuQOrqnLJ9Q?page=audit#top',
    ].join('\n');

    expect(extractLinkPreviewUrls(content)).toEqual([
      'https://ryugi.innei.dev/a/2CWv3qrwa7PuQOrqnLJ9Q?page=audit',
      'https://lobehub.example.com/docs',
      'https://example.com/x',
    ]);
  });

  it('ignores links quoted in code', () => {
    const content = [
      'run `curl https://inline.example.com/a`',
      '```sh',
      'curl https://fenced.example.com/b',
      '```',
      'see https://real.example.com/c',
    ].join('\n');

    expect(extractLinkPreviewUrls(content)).toEqual(['https://real.example.com/c']);
  });

  it('skips links another renderer owns and hosts that are not public sites', () => {
    const content =
      'https://app.example.com/task/T-1 http://localhost:3010/x https://ok.example.com';
    expect(
      extractLinkPreviewUrls(content, (url) => url.startsWith('https://app.example.com/')),
    ).toEqual(['https://ok.example.com/']);
  });

  it(`stops at ${MAX_LINK_PREVIEWS} cards`, () => {
    const content = Array.from({ length: 5 }, (_, i) => `https://site${i}.example.com`).join(' ');
    expect(extractLinkPreviewUrls(content)).toHaveLength(MAX_LINK_PREVIEWS);
  });
});
