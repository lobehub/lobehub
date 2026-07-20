import { ConnectorDataError } from '@lobechat/connector-data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGmailUnderstandingProvider } from './gmail';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@lobechat/connector-data/gmail', () => ({
  createGmailConnectorClient: createClient,
  toGmailMessagesXml: vi.fn(() => '<gmail-messages />'),
}));

const source = {
  candidateId: 'connector:gmail',
  credential: { connectedAccountId: 'gmail-account' },
  credentialOrigin: 'connector' as const,
  credentialReference: 'connector:gmail',
  externalAccountId: 'gmail-account',
  grantedScopes: [],
  id: 'gmail',
  provider: 'gmail',
};

describe('createGmailUnderstandingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps message evidence when one search remains retryable', async () => {
    createClient.mockReturnValue({
      searchMessages: vi.fn(async ({ query }: { query: string }) => {
        if (query.includes('receipt')) {
          throw new ConnectorDataError({
            code: 'gmail_search_failed',
            operation: 'searchMessages',
            provider: 'gmail',
            retryable: true,
          });
        }
        if (query === 'newer_than:90d') {
          return [
            {
              id: 'message-1',
              labels: ['INBOX'],
              sender: 'sender@example.com',
              subject: 'Project update',
            },
          ];
        }
        return [];
      }),
    });

    await expect(
      createGmailUnderstandingProvider({ composio: {} as never }).collect(source, {
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({
      context: expect.stringContaining('<gmail-messages />'),
      diagnostics: {
        errors: [
          expect.objectContaining({
            code: 'GMAIL_SEARCH_FAILED',
            operation: 'receipts',
            retryable: true,
          }),
        ],
        evidenceCount: 1,
        failedCount: 1,
        succeededCount: 7,
      },
      sourceCount: 1,
    });
  });

  it('throws a retryable provider error when no search returns usable messages', async () => {
    createClient.mockReturnValue({
      searchMessages: vi.fn(async ({ query }: { query: string }) => {
        if (query.includes('receipt')) {
          throw new ConnectorDataError({
            code: 'gmail_search_failed',
            operation: 'searchMessages',
            provider: 'gmail',
            retryable: true,
          });
        }
        return [];
      }),
    });

    await expect(
      createGmailUnderstandingProvider({ composio: {} as never }).collect(source, {
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      name: 'UnderstandingProviderAuthorizationError',
      retryable: true,
    });
  });
});
