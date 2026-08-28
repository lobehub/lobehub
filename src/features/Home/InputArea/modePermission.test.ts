import { describe, expect, it } from 'vitest';

import { isHomeModeDisabled, resolvePermittedHomeMode } from './modePermission';

describe('home mode permission', () => {
  it('keeps restricted users out of Task mode', () => {
    expect(isHomeModeDisabled('task', false)).toBe(true);
    expect(resolvePermittedHomeMode('task', false)).toBe('chat');
  });

  it('does not alter modes that the user may enter', () => {
    expect(isHomeModeDisabled('chat', false)).toBe(false);
    expect(resolvePermittedHomeMode('chat', false)).toBe('chat');
    expect(resolvePermittedHomeMode('task', true)).toBe('task');
  });
});
