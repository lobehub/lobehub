import { describe, expect, it } from 'vitest';

import {
  type InterestAreaTranslator,
  normalizeInterestsForStorage,
  resolveInterestAreaKey,
} from './interestKeys';

const labels: Record<string, string> = {
  'interests.area.coding': '编程与开发',
  'interests.area.personal': 'Personal Life',
  'interests.area.writing': 'Content Creation',
};

const t: InterestAreaTranslator = (key) => labels[key] ?? key;

describe('interestKeys', () => {
  it('resolves canonical keys, localized labels, and leaked i18n keys', () => {
    expect(resolveInterestAreaKey('coding', t)).toBe('coding');
    expect(resolveInterestAreaKey('编程与开发', t)).toBe('coding');
    expect(resolveInterestAreaKey('Content Creation', t)).toBe('writing');
    expect(resolveInterestAreaKey('interests.area.personal', t)).toBe('personal');
  });

  it('normalizes predefined interests while preserving freeform values', () => {
    expect(
      normalizeInterestsForStorage(
        ['编程与开发', 'Content Creation', 'interests.area.personal', '金融', 'coding'],
        t,
      ),
    ).toEqual(['coding', 'writing', 'personal', '金融']);
  });
});
