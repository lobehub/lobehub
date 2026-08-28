import { describe, expect, it, vi } from 'vitest';

import { ConnectorDataError } from '../errors';
import { createGmailConnectorClient } from './client';

const createClient = (
  execute: ReturnType<typeof vi.fn>,
  options: { resolveVersion?: ReturnType<typeof vi.fn> } = {},
) =>
  createGmailConnectorClient({
    composio: {
      connectedAccounts: { get: vi.fn(), list: vi.fn() },
      tools: { execute, getRawComposioToolBySlug: options.resolveVersion },
    },
    connectedAccountId: 'account-1',
    ...(options.resolveVersion ? {} : { toolVersion: '20250909_00' }),
    userId: 'user-1',
  });

describe('createGmailConnectorClient', () => {
  it('executes a bounded Gmail search and normalizes nested messages', async () => {
    const execute = vi.fn().mockResolvedValue({
      result: {
        data: {
          messages: [
            {
              id: 'message-1',
              labelIds: ['INBOX'],
              sender: 'Sender <sender@example.com>',
              subject: 'Status',
            },
          ],
        },
      },
      successful: true,
    });

    await expect(
      createClient(execute).searchMessages({ maxResults: 10_000, query: 'newer_than:90d' }),
    ).resolves.toEqual([
      {
        id: 'message-1',
        labels: ['INBOX'],
        sender: 'sender@example.com',
        sourceUrl: 'gmail:message:message-1',
        subject: 'Status',
      },
    ]);
    expect(execute).toHaveBeenCalledWith('GMAIL_FETCH_EMAILS', {
      arguments: { max_results: 25, query: 'newer_than:90d' },
      connectedAccountId: 'account-1',
      userId: 'user-1',
      version: '20250909_00',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'falls back to the safe default for non-finite maxResults %s',
    async (maxResults) => {
      const execute = vi.fn().mockResolvedValue({ data: [], successful: true });

      await createClient(execute).searchMessages({ maxResults, query: 'receipt' });

      expect(execute).toHaveBeenCalledWith(
        'GMAIL_FETCH_EMAILS',
        expect.objectContaining({ arguments: { max_results: 25, query: 'receipt' } }),
      );
    },
  );

  /** @example expect(error.message).toContain('token=secret'); */
  it('retains resolved failures and rethrows rejected Composio errors', async () => {
    const rejectedError = new Error('account-1 token=secret');
    const resolvedFailure = { error: 'token=secret', successful: false };
    const execute = vi
      .fn()
      .mockResolvedValueOnce(resolvedFailure)
      .mockRejectedValueOnce(rejectedError);
    const client = createClient(execute);

    const resolvedError = await client
      .searchMessages({ query: 'receipt' })
      .catch((reason) => reason);
    /** @example expect(resolvedError).toBeInstanceOf(ConnectorDataError); */
    expect(resolvedError).toBeInstanceOf(ConnectorDataError);
    /** @example expect(resolvedError.message).toContain('token=secret'); */
    expect(resolvedError.message).toContain('token=secret');
    /** @example expect(resolvedError.cause).toBe(resolvedFailure); */
    expect(resolvedError.cause).toBe(resolvedFailure);

    const thrownError = await client.searchMessages({ query: 'receipt' }).catch((reason) => reason);
    /** @example expect(thrownError).toBe(rejectedError); */
    expect(thrownError).toBe(rejectedError);
  });

  it.each([
    { data: [] },
    { data: [], successful: 'true' },
    { data: { messages: [{ unexpected: true }] }, successful: true },
    { payload: { unexpected: true }, successful: true },
  ])('rejects malformed Composio search responses', async (response) => {
    await expect(
      createClient(vi.fn().mockResolvedValue(response)).searchMessages({ query: 'receipt' }),
    ).rejects.toMatchObject({
      operation: 'searchMessages',
      provider: 'gmail',
      retryable: false,
    });
  });

  it('resolves and caches an explicit Composio tool version', async () => {
    const resolveVersion = vi.fn().mockResolvedValue({ version: '20250909_00' });
    const execute = vi.fn().mockResolvedValue({ data: [], successful: true });
    const client = createClient(execute, { resolveVersion });

    await client.searchMessages({ query: 'receipt' });
    await client.searchMessages({ query: 'invoice' });

    expect(resolveVersion).toHaveBeenCalledOnce();
    expect(resolveVersion).toHaveBeenCalledWith('GMAIL_FETCH_EMAILS');
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'GMAIL_FETCH_EMAILS',
      expect.objectContaining({ version: '20250909_00' }),
    );
  });
});
