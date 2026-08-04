import { describe, expect, it } from 'vitest';

import { HOME_COUNT_MAX, HOME_CUSTOMIZE_DEFAULTS } from '../CustomizeModal/config';
import { HOME_TOPIC_RECENT_LIMIT, resolveRecentsBadgeCount } from '../HomeModeContent';

describe('HOME_TOPIC_RECENT_LIMIT', () => {
  it('fetches the stepper max as a fixed constant, independent of the homeRecentsCount preference', () => {
    expect(HOME_TOPIC_RECENT_LIMIT).toBe(HOME_COUNT_MAX);
    expect(HOME_TOPIC_RECENT_LIMIT).toBe(15);
  });
});

describe('resolveRecentsBadgeCount', () => {
  it('counts the rows the list shows, not the larger set the page fetched', () => {
    expect(
      resolveRecentsBadgeCount(HOME_TOPIC_RECENT_LIMIT, HOME_CUSTOMIZE_DEFAULTS.homeRecentsCount),
    ).toBe(HOME_CUSTOMIZE_DEFAULTS.homeRecentsCount);
  });

  it('counts what arrived when the fetch returns fewer than the preference', () => {
    expect(resolveRecentsBadgeCount(3, 8)).toBe(3);
  });

  it('drops the badge when there is nothing to count', () => {
    expect(resolveRecentsBadgeCount(0, 8)).toBeUndefined();
  });
});
