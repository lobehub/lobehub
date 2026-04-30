import type { FollowUpExtractInput, FollowUpExtractResult } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class FollowUpActionService {
  /**
   * Extract chips for a message. Returns null on abort or any failure (silent).
   */
  async extract(
    input: FollowUpExtractInput,
    signal?: AbortSignal,
  ): Promise<FollowUpExtractResult | null> {
    try {
      const result = await lambdaClient.followUpAction.extract.mutate(input, { signal } as any);
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      // eslint-disable-next-line no-console
      console.warn('[FollowUpAction] extract failed', err);
      return null;
    }
  }
}

export const followUpActionService = new FollowUpActionService();
