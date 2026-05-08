import { parseCronPattern } from '@lobechat/utils/cron';
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
  'operations',
  'hr',
  'finance-legal',
  'creator',
  'investing',
  'parenting',
  'health',
  'hobbies',
  'personal',
]);

describe('taskTemplates', () => {
  it('has the expected number of templates', () => {
    expect(taskTemplates).toHaveLength(84);
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

  // parseCronPattern only renders 'daily' / 'weekly' / 'hourly' schedule strings.
  // Monthly or event-driven cron patterns silently fall back to daily display —
  // guard against accidental introduction here.
  it('every template parses to daily or weekly schedule', () => {
    for (const t of taskTemplates) {
      const { scheduleType } = parseCronPattern(t.cronPattern);
      expect(['daily', 'weekly'], `template ${t.id} scheduleType`).toContain(scheduleType);
    }
  });

  it('covers every fallback category at least once', () => {
    const categories = new Set(taskTemplates.map((t) => t.category));
    for (const fallback of TASK_TEMPLATE_FALLBACK_CATEGORIES) {
      expect(categories.has(fallback), `fallback category ${fallback}`).toBe(true);
    }
  });

  it('every optionalSkills entry uses a valid source and non-empty provider', () => {
    for (const t of taskTemplates) {
      if (!t.optionalSkills) continue;
      for (const spec of t.optionalSkills) {
        expect(['klavis', 'lobehub'], `template ${t.id} optional source`).toContain(spec.source);
        expect(
          spec.provider.length,
          `template ${t.id} optional provider "${spec.provider}"`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('optionalSkills do not duplicate requiresSkills', () => {
    for (const t of taskTemplates) {
      if (!t.optionalSkills || !t.requiresSkills) continue;
      const reqKeys = new Set(t.requiresSkills.map((s) => `${s.source}:${s.provider}`));
      for (const spec of t.optionalSkills) {
        expect(
          reqKeys.has(`${spec.source}:${spec.provider}`),
          `template ${t.id} duplicate skill ${spec.source}:${spec.provider}`,
        ).toBe(false);
      }
    }
  });
});
