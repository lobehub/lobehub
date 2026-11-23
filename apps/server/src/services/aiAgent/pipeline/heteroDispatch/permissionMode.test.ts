import { describe, expect, it } from 'vitest';

import { resolveDispatchPermissionMode } from './permissionMode';

describe('resolveDispatchPermissionMode', () => {
  it('starts Claude Code in the topic mode, bypassPermissions by default', () => {
    expect(
      resolveDispatchPermissionMode({
        heteroType: 'claude-code',
        topicMetadata: { heteroPermissionMode: 'plan' },
      }),
    ).toBe('plan');
    expect(resolveDispatchPermissionMode({ heteroType: 'claude-code', topicMetadata: {} })).toBe(
      'bypassPermissions',
    );
    expect(
      resolveDispatchPermissionMode({ heteroType: 'claude-code', topicMetadata: undefined }),
    ).toBe('bypassPermissions');
  });

  it('sends no mode for other agents', () => {
    expect(
      resolveDispatchPermissionMode({
        heteroType: 'codex',
        topicMetadata: { heteroPermissionMode: 'plan' },
      }),
    ).toBeUndefined();
  });
});
