import { describe, expect, it } from 'vitest';

import { useShare } from './useShare';

const url = 'https://lobehub.com/community/agent/abc';

describe('useShare', () => {
  const links = useShare({ desc: 'Writes code', title: 'Coder', url });

  it('opens the Telegram share page with the link and text', () => {
    const parsed = new URL(links.telegram.link);

    // A stray quote used to end the path as `/share/url"`, a dead page.
    expect(parsed.origin + parsed.pathname).toBe('https://t.me/share/url');
    expect(parsed.searchParams.get('url')).toBe(url);
    expect(parsed.searchParams.get('text')).toBe('Coder - Writes code');
  });

  it.each([
    ['reddit', 'https://www.reddit.com/submit'],
    ['whatsapp', 'https://api.whatsapp.com/send'],
    ['mastodon', 'https://mastodon.social/share'],
  ] as const)('builds the %s link on its share endpoint', (platform, endpoint) => {
    const parsed = new URL(links[platform].link);

    expect(parsed.origin + parsed.pathname).toBe(endpoint);
    expect(links[platform].link).toContain(encodeURIComponent(url));
  });

  it('leaves X and Weibo to SocialShare', () => {
    expect(Object.keys(links).sort()).toEqual(['mastodon', 'reddit', 'telegram', 'whatsapp']);
  });
});
