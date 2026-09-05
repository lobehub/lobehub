import { describe, expect, it } from 'vitest';

import { parseShareSettingsTab } from './useShareSettingsTab';

describe('parseShareSettingsTab', () => {
  it('resolves the stats tab', () => {
    expect(parseShareSettingsTab('stats')).toBe('stats');
  });

  it.each([null, undefined, '', 'access', 'unknown', 'STATS'])(
    'falls back to access for %p',
    (value) => {
      expect(parseShareSettingsTab(value)).toBe('access');
    },
  );
});
