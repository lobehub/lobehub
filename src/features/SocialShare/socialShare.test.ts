import { describe, expect, it, vi } from 'vitest';

import {
  buildSocialShareActions,
  buildTwitterShareUrl,
  buildTwitterText,
  buildWeiboShareUrl,
  composeShareCopy,
  INSTAGRAM_URL,
  openShareWindow,
  SHARE_SIGNATURE,
  shareToInstagram,
  TWITTER_MAX_WEIGHT,
  TWITTER_URL_WEIGHT,
  twitterTextWeight,
} from './socialShare';

const url = 'https://app.lobehub.com/share/t/abc123';
const input = { description: '来看看这段对话', title: 'React & Vue 对比?', url };

describe('composeShareCopy', () => {
  it('joins title, description and the LobeHub signature, then the link', () => {
    const copy = composeShareCopy(input);

    expect(copy.text).toBe(`React & Vue 对比? — 来看看这段对话 ${SHARE_SIGNATURE}`);
    expect(copy.textWithUrl).toBe(`${copy.text}\n${url}`);
    expect(copy.url).toBe(url);
  });

  it('drops an empty description and collapses whitespace', () => {
    expect(composeShareCopy({ title: '  Hello \n world ', url }).text).toBe(
      `Hello world ${SHARE_SIGNATURE}`,
    );
  });
});

describe('platform share URLs', () => {
  it('builds an x.com post intent whose text carries the copy and the link', () => {
    const href = buildTwitterShareUrl(input);
    const parsed = new URL(href);

    // twitter.com/intent/tweet only redirects here, and its universal link can
    // open the X app without the draft.
    expect(parsed.origin + parsed.pathname).toBe('https://x.com/intent/post');
    // The whole post, link included, is the prefill; nothing rides on `url`.
    expect([...parsed.searchParams.keys()]).toEqual(['text']);
    expect(parsed.searchParams.get('text')).toBe(composeShareCopy(input).textWithUrl);
    // Reserved characters in the link and the copy are percent-encoded.
    expect(href).toContain(encodeURIComponent(url));
    expect(href).toContain('%0A');
    expect(href).toContain('%26');
    expect(href).toContain('%3F');
    expect(href).not.toContain(' ');
    expect(href).not.toContain('+');
  });

  it('builds a Weibo share page URL with the encoded link and copy', () => {
    const href = buildWeiboShareUrl(input);
    const parsed = new URL(href);

    expect(parsed.origin + parsed.pathname).toBe('https://service.weibo.com/share/share.php');
    expect(parsed.searchParams.get('url')).toBe(url);
    expect(parsed.searchParams.get('title')).toBe(composeShareCopy(input).text);
    expect(href).toContain(`url=${encodeURIComponent(url)}`);
    expect(href).toContain('%2Fshare%2Ft%2Fabc123');
    // Weibo shows `+` literally, so spaces must be %20.
    expect(href).not.toContain('+');
    expect(href).toContain('React%20%26%20Vue');
  });

  it('keeps the same link and copy across all four platforms', () => {
    const actions = buildSocialShareActions(input);
    const copy = composeShareCopy(input);

    const x = new URL(actions.x.href);
    const weibo = new URL(actions.weibo.href);

    expect(x.searchParams.get('text')).toBe(copy.textWithUrl);
    expect(weibo.searchParams.get('url')).toBe(url);
    expect(weibo.searchParams.get('title')).toBe(copy.text);

    expect(actions.instagram).toEqual({
      copy,
      kind: 'clipboard',
      openUrl: INSTAGRAM_URL,
      platform: 'instagram',
    });
    expect(actions.wechat).toEqual({ copy, kind: 'qrcode', platform: 'wechat', qrValue: url });
  });
});

describe('buildTwitterText', () => {
  it('shortens a long title so the post fits X and keeps the signature', () => {
    const long = { title: '超长标题'.repeat(80), url };
    const text = buildTwitterText(long);

    expect(twitterTextWeight(text) + 1 + TWITTER_URL_WEIGHT).toBeLessThanOrEqual(
      TWITTER_MAX_WEIGHT,
    );
    expect(text.endsWith(`… ${SHARE_SIGNATURE}`)).toBe(true);
  });

  // The ellipsis (U+2026) itself weighs 2 on X; reserving only 1 for it used
  // to push a long Latin title to 281.
  it.each([
    ['Latin', { title: 'a'.repeat(400), url }],
    ['Latin words', { title: 'lorem ipsum dolor sit amet '.repeat(20), url }],
    ['Chinese', { title: '超长标题'.repeat(80), url }],
    [
      'mixed',
      {
        description: '对比 React and Vue 的差异 🚀'.repeat(10),
        title: 'AI 编程 Tips '.repeat(30),
        url,
      },
    ],
    ['odd boundary', { title: `${'a'.repeat(243)}中文`, url }],
  ])('keeps a long %s title within 280 with the full link', (_, longInput) => {
    const text = buildTwitterText(longInput);
    const shareUrl = buildTwitterShareUrl(longInput);
    const params = new URL(shareUrl).searchParams;

    expect(text).toContain('…');
    expect(text.endsWith(SHARE_SIGNATURE)).toBe(true);
    // The link follows a line break and X weighs any link at 23.
    expect(twitterTextWeight(text) + 1 + TWITTER_URL_WEIGHT).toBeLessThanOrEqual(
      TWITTER_MAX_WEIGHT,
    );
    // Truncation only touches the copy: the full link survives at the end.
    expect(params.get('text')).toBe(`${text}\n${url}`);
    expect(params.get('text')).toMatch(/\/share\/t\/abc123$/);
  });

  it('counts the ellipsis as two', () => {
    expect(twitterTextWeight('…')).toBe(2);
  });

  it('counts CJK as two and Latin as one', () => {
    expect(twitterTextWeight('ab')).toBe(2);
    expect(twitterTextWeight('中文')).toBe(4);
  });
});

describe('openShareWindow', () => {
  it('opens a plain new tab without an opener', () => {
    const open = vi.fn();
    openShareWindow('https://x.com/intent/post?text=x', { open });

    // A sized popup would squeeze the intent page into its narrow layout.
    expect(open).toHaveBeenCalledWith(
      'https://x.com/intent/post?text=x',
      '_blank',
      'noopener,noreferrer',
    );
  });
});

describe('shareToInstagram', () => {
  const copy = composeShareCopy(input);

  it('copies the caption with the link when there is no share sheet', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);

    await expect(shareToInstagram(copy, { copy: writeClipboard })).resolves.toBe('copied');
    expect(writeClipboard).toHaveBeenCalledWith(copy.textWithUrl);
  });

  it('prefers the system share sheet when available', async () => {
    const writeClipboard = vi.fn();
    const share = vi.fn().mockResolvedValue(undefined);

    await expect(
      shareToInstagram(copy, { copy: writeClipboard, navigator: { canShare: () => true, share } }),
    ).resolves.toBe('native');
    expect(share).toHaveBeenCalledWith({ text: copy.textWithUrl });
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('treats a dismissed share sheet as cancelled', async () => {
    const writeClipboard = vi.fn();
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));

    await expect(
      shareToInstagram(copy, { copy: writeClipboard, navigator: { share } }),
    ).resolves.toBe('cancelled');
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when the share sheet fails', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new Error('not allowed'));

    await expect(
      shareToInstagram(copy, { copy: writeClipboard, navigator: { share } }),
    ).resolves.toBe('copied');
    expect(writeClipboard).toHaveBeenCalledWith(copy.textWithUrl);
  });
});
