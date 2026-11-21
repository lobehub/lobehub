import { describe, expect, it } from 'vitest';

import { getOAuthErrorPresentation } from './oauthErrorPresentation';

const messages = {
  blocked: 'Allow popups and try again.',
  dismissed: 'Authorization was canceled. Try again.',
  failed: 'Authorization failed. Check your settings and try again.',
  timeout: 'Authorization timed out. Try again.',
};

describe('OAuth install error presentation', () => {
  it.each(['blocked', 'dismissed', 'failed', 'timeout'] as const)(
    'keeps the readable %s message without redundant technical details',
    (reason) => {
      expect(getOAuthErrorPresentation(reason, messages)).toEqual({
        detail: undefined,
        summary: messages[reason],
      });
    },
  );

  it.each(['Registration rejected: HTTP 503', 'toString', '<script>alert(1)</script>'])(
    'keeps an unknown error out of the summary: %s',
    (error) => {
      expect(getOAuthErrorPresentation(error, messages)).toEqual({
        detail: error,
        summary: messages.failed,
      });
    },
  );
});
