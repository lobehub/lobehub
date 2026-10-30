import { describe, expect, it } from 'vitest';

import { isRoutingGroupId } from './isRoutingGroupId';

describe('isRoutingGroupId', () => {
  it('knows both ids magpie gives a routing group', () => {
    expect(isRoutingGroupId('group/my-fastest', 'magpie')).toBe(true);
    expect(isRoutingGroupId('group/auto-claude-opus-5-5', 'magpie')).toBe(true);
    expect(isRoutingGroupId('auto/claude-opus-5.5', 'magpie')).toBe(true);
  });

  it('is false for a model one provider serves', () => {
    expect(isRoutingGroupId('workbuddy/kimi-k3-1', 'magpie')).toBe(false);
    expect(isRoutingGroupId('gpt-5.6-sol', 'magpie')).toBe(false);
  });

  it('reads the prefix only for magpie, whose ids spell a group that way', () => {
    // Another provider's `group/…` is that provider's own id, not a routing group.
    expect(isRoutingGroupId('group/some-id', 'openai')).toBe(false);
    expect(isRoutingGroupId('auto/whatever', 'ollama')).toBe(false);
    expect(isRoutingGroupId('group/some-id')).toBe(false);
  });
});
