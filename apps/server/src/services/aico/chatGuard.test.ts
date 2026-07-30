import { describe, expect, it } from 'vitest';

import { AicoChatGuard } from './chatGuard';

describe('AicoChatGuard', () => {
  it('treats aico and openrouter as managed providers', () => {
    expect(AicoChatGuard.isManagedProvider('aico')).toBe(true);
    expect(AicoChatGuard.isManagedProvider('openrouter')).toBe(true);
    expect(AicoChatGuard.isManagedProvider('openai')).toBe(false);
  });

  it('maps aico runtime to openrouter', () => {
    expect(AicoChatGuard.resolveRuntimeProvider('aico')).toBe('openrouter');
    expect(AicoChatGuard.resolveRuntimeProvider('openrouter')).toBe('openrouter');
  });
});
