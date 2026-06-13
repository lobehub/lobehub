import { describe, expect, it } from 'vitest';

import { getRemoteModelFetchErrorMessage } from './utils';

describe('getRemoteModelFetchErrorMessage', () => {
  it('should read regular Error messages', () => {
    expect(getRemoteModelFetchErrorMessage(new Error('model fetch failed'))).toBe(
      'model fetch failed',
    );
  });

  it('should unwrap nested runtime payload messages', () => {
    expect(
      getRemoteModelFetchErrorMessage({
        error: {
          message: 'No GitHub Copilot subscription or access denied',
        },
        errorType: 'PermissionDenied',
      }),
    ).toBe('No GitHub Copilot subscription or access denied');
  });

  it('should prefer nested body messages over generic top-level messages', () => {
    expect(
      getRemoteModelFetchErrorMessage({
        body: {
          error: {
            message: 'Cloudflare models API returned an invalid response',
          },
        },
        message: 'ProviderBizError',
      }),
    ).toBe('Cloudflare models API returned an invalid response');
  });

  it('should avoid circular payloads', () => {
    const payload: Record<string, unknown> = { message: 'fallback message' };
    payload.error = payload;

    expect(getRemoteModelFetchErrorMessage(payload)).toBe('fallback message');
  });
});
