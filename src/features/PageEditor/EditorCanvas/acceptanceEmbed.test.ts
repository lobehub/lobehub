import { describe, expect, it } from 'vitest';

import {
  ACCEPTANCE_EMBED_PATH,
  isPageAcceptanceEmbedEnabled,
  matchesPageAcceptanceEmbed,
} from './acceptanceEmbed';

describe('page acceptance embed rule', () => {
  const location = { origin: 'https://app.example.com' };

  it('requires the explicit acceptance flag', () => {
    expect(isPageAcceptanceEmbedEnabled('true')).toBe(true);
    expect(isPageAcceptanceEmbedEnabled('1')).toBe(true);
    expect(isPageAcceptanceEmbedEnabled('')).toBe(false);
    expect(matchesPageAcceptanceEmbed(ACCEPTANCE_EMBED_PATH, location, false)).toBe(false);
  });

  it('matches only the same-origin fixture path', () => {
    expect(
      matchesPageAcceptanceEmbed(`https://app.example.com${ACCEPTANCE_EMBED_PATH}`, location, true),
    ).toBe(true);
    expect(
      matchesPageAcceptanceEmbed(
        `https://attacker.example.com${ACCEPTANCE_EMBED_PATH}`,
        location,
        true,
      ),
    ).toBe(false);
    expect(matchesPageAcceptanceEmbed('/other.html', location, true)).toBe(false);
  });
});
