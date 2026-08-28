import { ConnectorDataError } from '@lobechat/connector-data';
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

  /** @example A connector failure remains identifiable in partial diagnostics. */
  it('preserves the connector failure code and message for failed Gmail searches', async () => {
    const searchMessages = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'message-1',
          labels: ['INBOX'],
          sender: 'team@example.com',
          snippet: 'Project update',
          subject: 'Weekly update',
        },
      ])
      .mockRejectedValue(
        new ConnectorDataError({
          code: 'gmail_tool_version_unavailable',
          message: 'Composio could not resolve Gmail tool version 20260814',
          operation: 'searchMessages',
          provider: 'gmail',
          retryable: false,
        }),
      );

    const result = await gmailUnderstandingProvider.collect({
      connectorData: {
        getGmailClient: vi.fn(async () => ({
          getAccount: vi.fn(async () => ({
            externalAccountId: 'gmail-account',
            scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
          })),
          searchMessages,
        })),
      } as never,
      userId: 'user-id',
    });

    /** @example expect(result.diagnostics.failedCount).toBe(7); */
    expect(result.diagnostics).toMatchObject({ failedCount: 7, succeededCount: 1 });
    /** @example expect(result.diagnostics.errors).toHaveLength(7); */
    expect(result.diagnostics.errors).toHaveLength(7);
    /** @example expect(result.diagnostics.errors[0].code).toBe('gmail_tool_version_unavailable'); */
    expect(result.diagnostics.errors[0]).toMatchObject({
      code: 'gmail_tool_version_unavailable',
      message: 'Composio could not resolve Gmail tool version 20260814',
      operation: 'receipts',
      retryable: false,
    });
  });

  /** @example expect(error.cause).toBe(upstreamError); */
  it('retains the original retryable error when Gmail evidence collection fails', async () => {
    const upstreamError = new ConnectorDataError({
      code: 'gmail_search_failed',
      message: 'Composio Gmail search timed out',
      operation: 'searchMessages',
      provider: 'gmail',
      retryable: true,
    });
    const searchMessages = vi.fn().mockRejectedValueOnce(upstreamError).mockResolvedValue([]);

    const error = await gmailUnderstandingProvider
      .collect({
        connectorData: {
          getGmailClient: vi.fn(async () => ({
            getAccount: vi.fn(async () => ({
              externalAccountId: 'gmail-account',
              scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
            })),
            searchMessages,
          })),
        } as never,
        userId: 'user-id',
      })
      .catch((reason) => reason);

    /** @example expect(error).toBeInstanceOf(ConnectorDataError); */
    expect(error).toBeInstanceOf(ConnectorDataError);
    /** @example expect(error.cause).toBe(upstreamError); */
    expect(error.cause).toBe(upstreamError);
  });
});
