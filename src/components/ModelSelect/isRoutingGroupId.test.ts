import { describe, expect, it } from 'vitest';

import { isRoutingGroupId } from './isRoutingGroupId';

describe('isRoutingGroupId', () => {
  it('knows both ids magpie gives a routing group', () => {
    expect(isRoutingGroupId('group/my-fastest')).toBe(true);
    expect(isRoutingGroupId('group/auto-claude-opus-5-5')).toBe(true);
    expect(isRoutingGroupId('auto/claude-opus-5.5')).toBe(true);
  });

  it('is false for a model one provider serves', () => {
    expect(isRoutingGroupId('workbuddy/kimi-k3-1')).toBe(false);
    expect(isRoutingGroupId('openai/gpt-5.6-sol')).toBe(false);
    expect(isRoutingGroupId('gpt-5.6-sol')).toBe(false);
  });
});
