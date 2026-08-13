import { afterEach, describe, expect, it, vi } from 'vitest';

import { gmailUnderstandingProvider } from './gmail';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gmailUnderstandingProvider', () => {
  /** @example A Gmail account without read scopes is skipped before evidence searches run. */
  it('persists a non-retryable diagnostic when Gmail read permission is missing', async () => {
    // ROOT CAUSE:
    //
    // Connector availability only proves that an OAuth account exists. A user can finish Gmail
    // OAuth without granting read access, which previously caused every profile search to fail and
    // obscured the actionable permission problem behind a generic collection failure.
    //
    // We fixed this by checking the owned account scopes before issuing any Gmail search request.
    const searchMessages = vi.fn();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await gmailUnderstandingProvider.collect({
      connectorData: {
        getGmailClient: vi.fn(async () => ({
          getAccount: vi.fn(async () => ({
            externalAccountId: 'gmail-account',
            scopes: ['openid', 'email'],
          })),
          searchMessages,
        })),
      } as never,
      userId: 'user-id',
    });

    expect(searchMessages).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      '[understanding:gmail] skipped because Gmail read permission is missing',
    );
    expect(result).toEqual({
      context: '',
      diagnostics: {
        errors: [
          {
            code: 'GMAIL_READ_PERMISSION_REQUIRED',
            message: 'Gmail read permission is required to collect Understanding evidence',
            operation: 'permission',
            provider: 'gmail',
            retryable: false,
          },
        ],
        evidenceCount: 0,
        failedCount: 1,
        succeededCount: 0,
      },
      sourceCount: 0,
    });
  });
});
