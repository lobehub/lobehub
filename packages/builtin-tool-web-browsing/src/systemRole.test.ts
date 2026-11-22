import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('web browsing systemPrompt', () => {
  const prompt = systemPrompt();

  it('keeps the time range opt-in for time-sensitive queries', () => {
    expect(prompt).toContain('set `searchTimeRange` only for time-sensitive queries');
    expect(prompt).not.toMatch(/Default to[^;\n]*`searchTimeRange`/);
  });

  it('balances "a few authoritative sources" with cross-checking', () => {
    expect(prompt).toContain('verify key facts across sources');
    expect(prompt).toContain('perspectives for controversial topics');
  });

  it('escalates challenge/JS-wall crawl bodies to agent-browser', () => {
    expect(prompt).toContain('activate the `agent-browser` skill');
  });

  it('keeps error-specific recovery essays out of the always-on system prompt', () => {
    // Empty-search and crawl-error remedies travel on the error tool results themselves.
    expect(prompt).not.toContain('PageNotFoundError');
    expect(prompt).not.toContain('InvalidUrlError');
    expect(prompt).not.toContain('UnsupportedContentError');
    expect(prompt.length).toBeLessThan(900);
  });

  it('shows the footnote citation as renderable markdown, not inline code', () => {
    expect(prompt).toContain('[^1]: [');
    expect(prompt).not.toContain('`[^1]');
    expect(prompt).not.toContain('[^1].`');
  });
});
