import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exitVerifyPhoneFlow } from './useVerifyPhone';

describe('exitVerifyPhoneFlow', () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockReset();
    vi.stubGlobal('location', { assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns to callbackUrl instead of sign-in (logged-in trial verify)', () => {
    exitVerifyPhoneFlow('/settings/profile');

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/settings/profile');
    expect(assign.mock.calls[0][0]).not.toContain('signin');
  });

  it('falls back to home for unsafe callback URLs', () => {
    exitVerifyPhoneFlow('https://evil.example');

    expect(assign).toHaveBeenCalledWith('/');
  });
});
