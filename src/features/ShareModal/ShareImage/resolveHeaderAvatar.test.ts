import { describe, expect, it } from 'vitest';

import { resolveHeaderAvatar } from './resolveHeaderAvatar';

describe('resolveHeaderAvatar', () => {
  it('uses the header agent avatar', () => {
    expect(resolveHeaderAvatar({ avatar: '🦄' }, 'supervisor.png')).toBe('🦄');
  });

  it('does not borrow the current avatar for a header agent without one', () => {
    expect(resolveHeaderAvatar({}, 'supervisor.png')).toBeUndefined();
  });

  it('falls back to the current avatar without a header agent', () => {
    expect(resolveHeaderAvatar(undefined, 'supervisor.png')).toBe('supervisor.png');
  });
});
