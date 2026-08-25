import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorDataError } from '../errors';
import { createTwitterMarketConnectorClient } from './marketClient';

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
}));

vi.mock('debug', () => ({
  default: vi.fn(() => mocks.log),
}));

const createClient = (callTool: ReturnType<typeof vi.fn>) =>
  createTwitterMarketConnectorClient({ market: { callTool } });

/** @example Market X tools provide bounded profile and recent-post evidence. */
describe('createTwitterMarketConnectorClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** @example Profile and search calls use the Market X tool contract. */
  it('loads the authenticated profile and recent posts', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        data: { data: { id: '42', name: 'Ada', username: 'ada' } },
        success: true,
      })
      .mockResolvedValueOnce({
        data: { data: [{ author_id: '42', id: '100', text: 'Hello' }] },
        success: true,
      });
    const client = createClient(callTool);

    await expect(client.getProfile()).resolves.toMatchObject({ username: 'ada' });
    await expect(
      client.searchRecentPosts({ maxResults: 1, query: 'from:ada -is:retweet' }),
    ).resolves.toHaveLength(1);
    expect(callTool).toHaveBeenNthCalledWith(
      1,
      'get_me',
      expect.objectContaining({ userFields: expect.arrayContaining(['description']) }),
    );
    expect(callTool).toHaveBeenNthCalledWith(
      2,
      'search_tweets',
      expect.objectContaining({
        maxResults: 10,
        query: 'from:ada -is:retweet',
        sortOrder: 'recency',
      }),
    );
  });

  /** @example An embedded HTTP 402 retains its original provider message. */
  it('logs the original message for embedded Market tool failures', async () => {
    // ROOT CAUSE:
    //
    // Market reports a successful transport envelope while embedding the X provider failure in
    // `data.isError` and `data.statusCode`. The connector rejected the result correctly, but it
    // discarded the provider reason, so Understanding only exposed a generic collection failure.
    //
    // Before: `{ success: true, data: { isError: true, statusCode: 402, error: '...' } }`
    //         became an untraceable `twitter_searchRecentPosts_failed`.
    //
    // We now retain the original embedded provider message in the thrown diagnostic and log entry.
    const response = {
      data: {
        error: 'Twitter API Error: credits depleted (HTTP 402); token=secret',
        isError: true,
        statusCode: 402,
      },
      success: true,
    };
    const client = createClient(vi.fn(async () => response));

    const error = await client
      .searchRecentPosts({ query: 'from:ada -is:retweet' })
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(ConnectorDataError);
    expect(error).toMatchObject({
      code: 'twitter_searchRecentPosts_failed',
      message: 'Twitter API Error: credits depleted (HTTP 402); token=secret',
      operation: 'searchRecentPosts',
      retryable: false,
    });
    /** @example expect(error.cause).toBe(response); */
    expect(error.cause).toBe(response);
    expect(mocks.log).toHaveBeenCalledWith('Market X tool call failed: %O', {
      message: 'Twitter API Error: credits depleted (HTTP 402); token=secret',
      operation: 'searchRecentPosts',
      statusCode: 402,
      toolName: 'search_tweets',
    });
  });
});
