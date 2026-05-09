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
      const result = await lambdaClient.followUpAction.extract.mutate(input, { signal });
      return result;
    } catch (err) {
      // TRPC wraps DOMException in TRPCClientError, so check both the raw error
      // and the original signal — silent on any abort flow (timeout, manual clear).
      if (signal?.aborted) return null;
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      console.warn('[FollowUpAction] extract failed', err);
      return null;
    }
  }
}

export const followUpActionService = new FollowUpActionService();
