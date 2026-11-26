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

  it('keeps engine auto-selection and avoids ambiguous !category placeholder', () => {
    expect(prompt).toContain('let search choose engines automatically unless asked');
    expect(prompt).not.toContain('!category');
  });

  it('preserves URL and ambiguous-query guardrails from #18702 and #23595', () => {
    expect(prompt).toContain('Clarify ambiguous queries before extensive searching');
    expect(prompt).toContain(
      'never bare domains, markdown links, guessed paths, or non-HTML assets',
    );
  });

  it('escalates failed or challenge/JS-wall crawls to agent-browser', () => {
    expect(prompt).toContain('If a crawl fails or returns an empty');
    expect(prompt).toContain('activate the `agent-browser` skill');
  });

  it('keeps error-specific recovery essays out of the always-on system prompt', () => {
    // Empty-search and crawl-error remedies travel on the error tool results themselves.
    expect(prompt).not.toContain('PageNotFoundError');
    expect(prompt).not.toContain('InvalidUrlError');
    expect(prompt).not.toContain('UnsupportedContentError');
    expect(prompt.length).toBeLessThan(1400);
  });

  it('shows the footnote citation as renderable markdown, not inline code', () => {
    expect(prompt).toContain('[^1]: [');
    expect(prompt).not.toContain('`[^1]');
    expect(prompt).not.toContain('[^1].`');
  });
});
