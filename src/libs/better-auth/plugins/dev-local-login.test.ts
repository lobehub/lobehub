import { describe, expect, it } from 'vitest';

import { isDevLocalLoginEnabled, resolveDevLocalLoginCallback } from './dev-local-login';

describe('dev local login plugin helpers', () => {
  it('requires both development mode and the explicit bootstrap flag', () => {
    expect(isDevLocalLoginEnabled({ LOBE_DEV_AUTH_BOOTSTRAP: '1', NODE_ENV: 'development' })).toBe(
      true,
    );
    expect(isDevLocalLoginEnabled({ LOBE_DEV_AUTH_BOOTSTRAP: '0', NODE_ENV: 'development' })).toBe(
      false,
    );
    expect(isDevLocalLoginEnabled({ LOBE_DEV_AUTH_BOOTSTRAP: '1', NODE_ENV: 'production' })).toBe(
      false,
    );
  });

  it('only accepts relative same-origin callback URLs', () => {
    expect(resolveDevLocalLoginCallback('/settings')).toBe('/settings');
    expect(resolveDevLocalLoginCallback(undefined)).toBe('/');
    expect(resolveDevLocalLoginCallback('https://example.com')).toBe('/');
    expect(resolveDevLocalLoginCallback('//example.com')).toBe('/');
  });
});
