import { describe, expect, it } from 'vitest';

import { getRemoteModelFetchErrorMessage } from './utils';

describe('getRemoteModelFetchErrorMessage', () => {
  it('should read regular Error messages', () => {
    expect(getRemoteModelFetchErrorMessage(new Error('model fetch failed'))).toBe(
      'model fetch failed',
    );
  });

  it('should read top-level object messages', () => {
    expect(
      getRemoteModelFetchErrorMessage({
        message: 'model fetch failed',
      }),
    ).toBe('model fetch failed');
  });

  it('should not inspect nested runtime payload messages', () => {
    expect(
      getRemoteModelFetchErrorMessage({
        error: {
          message: 'No GitHub Copilot subscription or access denied',
        },
        errorType: 'PermissionDenied',
      }),
    ).toBeUndefined();
  });
});
