import { describe, expect, it } from 'vitest';

import { HOME_COUNT_MAX } from '../CustomizeModal/config';
import { HOME_TOPIC_RECENT_LIMIT } from '../HomeModeContent';

describe('HOME_TOPIC_RECENT_LIMIT', () => {
  it('fetches the stepper max as a fixed constant, independent of the homeRecentsCount preference', () => {
    expect(HOME_TOPIC_RECENT_LIMIT).toBe(HOME_COUNT_MAX);
    expect(HOME_TOPIC_RECENT_LIMIT).toBe(15);
  });
});
