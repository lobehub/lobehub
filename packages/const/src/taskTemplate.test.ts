import { describe, expect, it } from 'vitest';

import { TASK_TEMPLATE_FALLBACK_CATEGORIES, taskTemplates } from './taskTemplate';

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

describe('taskTemplates', () => {
  it('has the expected number of templates', () => {
    expect(taskTemplates).toHaveLength(19);
  });

  it('has unique ids', () => {
    const ids = taskTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template has non-empty interests from INTEREST_AREAS', () => {
    for (const t of taskTemplates) {
      expect(t.interests.length, `template ${t.id} interests`).toBeGreaterThan(0);
      for (const key of t.interests) {
        expect(VALID_INTEREST_KEYS.has(key), `template ${t.id} interest "${key}"`).toBe(true);
      }
    }
  });

  it('every template has a 5-field cron pattern', () => {
    for (const t of taskTemplates) {
      expect(t.cronPattern.trim().split(/\s+/), `template ${t.id} cron`).toHaveLength(CRON_FIELDS);
    }
  });

  it('covers every fallback category at least once', () => {
    const categories = new Set(taskTemplates.map((t) => t.category));
    for (const fallback of TASK_TEMPLATE_FALLBACK_CATEGORIES) {
      expect(categories.has(fallback), `fallback category ${fallback}`).toBe(true);
    }
  });
});
