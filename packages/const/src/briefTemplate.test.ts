import { describe, expect, it } from 'vitest';

import { BRIEF_TEMPLATE_FALLBACK_CATEGORIES, briefTemplates } from './briefTemplate';

const CRON_FIELDS = 5;
// Keep in sync with INTEREST_AREAS in lobehub/src/routes/onboarding/config.ts —
// those are the only values `users.interests` can hold.
const VALID_INTEREST_KEYS = new Set([
  'writing',
  'coding',
  'design',
  'education',
  'business',
  'marketing',
  'product',
  'sales',
]);

describe('briefTemplates', () => {
  it('has the expected number of templates', () => {
    expect(briefTemplates).toHaveLength(16);
  });

  it('has unique ids', () => {
    const ids = briefTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template has non-empty interests from INTEREST_AREAS', () => {
    for (const t of briefTemplates) {
      expect(t.interests.length, `template ${t.id} interests`).toBeGreaterThan(0);
      for (const key of t.interests) {
        expect(VALID_INTEREST_KEYS.has(key), `template ${t.id} interest "${key}"`).toBe(true);
      }
    }
  });

  it('every template has a 5-field cron pattern', () => {
    for (const t of briefTemplates) {
      expect(t.cronPattern.trim().split(/\s+/), `template ${t.id} cron`).toHaveLength(CRON_FIELDS);
    }
  });

  it('covers every fallback category at least once', () => {
    const categories = new Set(briefTemplates.map((t) => t.category));
    for (const fallback of BRIEF_TEMPLATE_FALLBACK_CATEGORIES) {
      expect(categories.has(fallback), `fallback category ${fallback}`).toBe(true);
    }
  });
});
