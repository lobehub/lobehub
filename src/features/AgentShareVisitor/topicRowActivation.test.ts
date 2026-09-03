import { describe, expect, it } from 'vitest';

import { isTopicRowActivationKey } from './topicRowActivation';

describe('isTopicRowActivationKey', () => {
  it('activates on Enter', () => {
    expect(isTopicRowActivationKey('Enter')).toBe(true);
  });

  it('activates on Space', () => {
    expect(isTopicRowActivationKey(' ')).toBe(true);
  });

  it('ignores other keys', () => {
    expect(isTopicRowActivationKey('Tab')).toBe(false);
    expect(isTopicRowActivationKey('ArrowDown')).toBe(false);
    expect(isTopicRowActivationKey('a')).toBe(false);
  });
});
