// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { defaultTaskRecommendationConfig } from '../config';
import { createGmailTaskRecommendationProvider } from './gmail';

/** @example Gmail evidence retains trusted subjects for source presentation. */
describe('createGmailTaskRecommendationProvider', () => {
  /** @example Duplicate search hits become one source with the connector-provided subject. */
  it('collects a subject alongside each unique Gmail source URL', async () => {
    const message = {
      id: 'message-1',
      labels: ['INBOX'],
      sourceUrl: 'gmail:thread:thread-1',
      subject: 'Your receipt from Comfy Org',
    };
    const searchMessages = vi.fn(async () => [message]);
    const provider = createGmailTaskRecommendationProvider(
      defaultTaskRecommendationConfig.providers.gmail,
    );

    const result = await provider.collect({
      connectorData: {
        getGmailClient: vi.fn(async () => ({ searchMessages })),
      },
    } as never);

    expect(result.sources).toEqual([
      {
        subject: 'Your receipt from Comfy Org',
        type: 'gmail',
        url: 'gmail:thread:thread-1',
      },
    ]);
  });
});
