import { describe, expect, it } from 'vitest';

import { displayTitle } from './WebpageFileItem';

describe('displayTitle', () => {
  it('keeps a real page title unchanged', () => {
    expect(displayTitle('Agent Skills Marketplace | LobeHub')).toBe(
      'Agent Skills Marketplace | LobeHub',
    );
  });

  it('falls back to the last path segment for URL-only titles', () => {
    expect(displayTitle('https://raw.githubusercontent.com/lobehub/lobehub/main/SKILL.md')).toBe(
      'SKILL.md',
    );
  });

  it('falls back to the hostname when the URL has no path', () => {
    expect(displayTitle('https://www.example.com/')).toBe('example.com');
  });
});
