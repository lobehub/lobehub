import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('web browsing systemPrompt', () => {
  const prompt = systemPrompt();

  it('keeps the time range opt-in for time-sensitive queries', () => {
    expect(prompt).toContain('Set `searchTimeRange` only for time-sensitive queries');
    expect(prompt).not.toMatch(/Default to[^;\n]*`searchTimeRange`/);
  });

  it('balances "a few authoritative sources" with cross-checking', () => {
    expect(prompt).toContain('Verify key facts across multiple sources');
    expect(prompt).toContain('sources representing different perspectives');
  });

  it('escalates every crawl failure to a real browser, not only recognised blocks', () => {
    expect(prompt).toContain('If a crawl fails (error, timeout, blocked)');
    expect(prompt).toContain('do NOT keep retrying with different queries or sources');
    expect(prompt).toContain('activate the `agent-browser` skill');
    expect(prompt).toContain('When in doubt, escalate');
  });

  it('skips browser escalation only for definitively dead links', () => {
    expect(prompt).toContain('definitively dead links (HTTP 404/410, non-existent domain)');
  });

  it('gives each non-retryable crawl error the remedy its tool result gives', () => {
    const line = prompt.split('\n').find((item) => item.includes('`PageNotFoundError`'));
    const [deadLink, nothingFetched] = line!.split('`InvalidUrlError`');

    expect(deadLink).toContain('search for a different source');
    expect(deadLink).not.toContain('fix the URL');
    expect(nothingFetched).toContain('`UnsupportedContentError`');
    expect(nothingFetched).toContain('fix the URL or pick a document page');
  });

  it('shows the footnote citation as renderable markdown, not inline code', () => {
    expect(prompt).toContain('[^1]: [');
    expect(prompt).not.toContain('`[^1]');
    expect(prompt).not.toContain('[^1].`');
  });
});
